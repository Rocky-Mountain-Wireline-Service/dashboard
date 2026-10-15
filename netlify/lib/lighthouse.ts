import type { Client } from '@libsql/client/web';
import config from '../../src/config/dashboard';
import { googleAccessToken, googleCredentials } from './google';

/**
 * Google Lighthouse scores for the live site, through the PageSpeed Insights API.
 *
 * Signs in as the same Google service account as analytics, so no separate key
 * is needed — only the PageSpeed Insights API enabled in that account's Cloud
 * project. Google refuses anonymous requests: the keyless allowance is shared
 * by everyone and always spent.
 *
 * Env:
 *   PSI_API_KEY      optional; an API key to use instead of the service account
 *   LIGHTHOUSE_URL   optional; the page to test. Defaults to the client's homepage.
 *
 * Only the homepage is tested, on mobile and on desktop. Each test takes Google
 * 10–30 seconds, and a scheduled function has about 30, so the two run side by
 * side and anything still running near the limit is dropped rather than
 * losing the one that finished.
 */

export type Strategy = 'mobile' | 'desktop';

/** Google's own thresholds for each measurement: good up to the first, poor beyond the second. */
const THRESHOLDS = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  tbt: [200, 600],
} as const;

export interface LighthouseResult {
  strategy: Strategy;
  scores: { performance: number; accessibility: number; bestPractices: number; seo: number };
  metrics: {
    lcp: { value: number; rating: Rating };
    cls: { value: number; rating: Rating };
    tbt: { value: number; rating: Rating };
  };
}
export type Rating = 'good' | 'needs-work' | 'poor';

export interface LighthouseCheck {
  url: string;
  checkedAt: string;
  mobile: LighthouseResult | null;
  desktop: LighthouseResult | null;
}

const TIME_LIMIT_MS = 26_000;

const rate = (value: number, [good, poor]: readonly [number, number]): Rating =>
  value <= good ? 'good' : value <= poor ? 'needs-work' : 'poor';

export const lighthouseConfigured = () => Boolean(process.env.PSI_API_KEY || googleCredentials());
export const lighthouseUrl = () => process.env.LIGHTHOUSE_URL || `https://${config.clientDomain}/`;

/** An API key if one is set; otherwise the service account, which only needs the `openid` scope here. */
async function authorize(params: URLSearchParams): Promise<Record<string, string>> {
  if (process.env.PSI_API_KEY) {
    params.set('key', process.env.PSI_API_KEY);
    return {};
  }
  const credentials = googleCredentials();
  if (!credentials) throw new Error('No PageSpeed credentials');
  return { Authorization: `Bearer ${await googleAccessToken(credentials, 'openid')}` };
}

async function run(url: string, strategy: Strategy, signal: AbortSignal): Promise<LighthouseResult> {
  const params = new URLSearchParams({ url, strategy });
  for (const category of ['performance', 'accessibility', 'best-practices', 'seo']) params.append('category', category);
  const headers = await authorize(params);

  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal, headers });
  if (!res.ok) throw new Error(`PageSpeed ${strategy} ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = (await res.json()) as {
    lighthouseResult?: {
      categories?: Record<string, { score: number | null }>;
      audits?: Record<string, { numericValue?: number }>;
    };
  };
  const lh = data.lighthouseResult;
  if (!lh?.categories) throw new Error(`PageSpeed ${strategy}: no Lighthouse result`);

  const score = (id: string) => Math.round((lh.categories?.[id]?.score ?? 0) * 100);
  const audit = (id: string) => lh.audits?.[id]?.numericValue ?? 0;
  const lcp = Math.round(audit('largest-contentful-paint'));
  const cls = Math.round(audit('cumulative-layout-shift') * 1000) / 1000;
  const tbt = Math.round(audit('total-blocking-time'));

  return {
    strategy,
    scores: {
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo'),
    },
    metrics: {
      lcp: { value: lcp, rating: rate(lcp, THRESHOLDS.lcp) },
      cls: { value: cls, rating: rate(cls, THRESHOLDS.cls) },
      tbt: { value: tbt, rating: rate(tbt, THRESHOLDS.tbt) },
    },
  };
}

/** Tests the homepage on mobile and desktop. Returns null only when neither finished. */
export async function runLighthouse(): Promise<LighthouseCheck | null> {
  if (!lighthouseConfigured()) return null;
  const url = lighthouseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIME_LIMIT_MS);

  const settle = (strategy: Strategy) =>
    run(url, strategy, controller.signal).catch((err) => {
      console.error(`Lighthouse ${strategy} failed:`, err instanceof Error ? err.message : err);
      return null;
    });

  try {
    const [mobile, desktop] = await Promise.all([settle('mobile'), settle('desktop')]);
    if (!mobile && !desktop) return null;
    return { url, checkedAt: new Date().toISOString(), mobile, desktop };
  } finally {
    clearTimeout(timer);
  }
}

export async function saveLighthouse(db: Client, check: LighthouseCheck): Promise<void> {
  await db.execute({
    sql: `INSERT INTO site_checks (client_id, kind, data, checked_at) VALUES (?, 'lighthouse', ?, ?)`,
    args: [config.clientId, JSON.stringify(check), check.checkedAt.slice(0, 19).replace('T', ' ')],
  });
}

/** The newest check taken between two dates (YYYY-MM-DD, inclusive), or null. */
export async function latestLighthouse(db: Client, from: string, to: string): Promise<LighthouseCheck | null> {
  const row = (
    await db.execute({
      sql: `SELECT data FROM site_checks
             WHERE client_id = ? AND kind = 'lighthouse' AND checked_at >= ? AND checked_at < date(?, '+1 day')
             ORDER BY checked_at DESC LIMIT 1`,
      args: [config.clientId, from, to],
    })
  ).rows[0];
  return row ? (JSON.parse(String(row.data)) as LighthouseCheck) : null;
}
