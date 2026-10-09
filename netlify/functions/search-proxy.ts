import { json, requireUser } from '../lib/auth';
import { dateIn, googleAccessToken, googleCredentials, reportTimeZone } from '../lib/google';
import config from '../../src/config/dashboard';

/**
 * What people typed into Google before reaching the site, from Search Console.
 *
 * Analytics cannot answer this: Google stopped passing search terms to websites
 * years ago, and Search Console is the only place they are reported.
 *
 * Uses the same service account as analytics. It needs two things done once:
 * the Google Search Console API enabled in the account's Cloud project, and the
 * account's address added as a user on the Search Console property. Until both
 * are in place this answers `configured: false`.
 *
 * Env: GSC_SITE_URL — optional. The property to read, e.g. `sc-domain:rmws.com`.
 *      Left unset, the property matching the client's domain is found by itself.
 *
 * Query: ?period=7d|30d|13w|12m|all
 */

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://www.googleapis.com/webmasters/v3';

/** Search Console keeps sixteen months; "all" is as far back as it goes. */
const DAYS: Record<string, number> = { '7d': 7, '30d': 30, '13w': 91, '12m': 365, all: 480 };

/** Its figures arrive about two days late; asking for today returns nothing. */
const LAG_DAYS = 2;

interface SearchRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  position: number;
}

let cachedSite: string | null = null;

async function findSite(token: string): Promise<string | null> {
  if (process.env.GSC_SITE_URL) return process.env.GSC_SITE_URL;
  if (cachedSite) return cachedSite;

  const res = await fetch(`${API}/sites`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw Object.assign(new Error(`sites.list ${res.status}`), { status: res.status });

  const { siteEntry = [] } = (await res.json()) as {
    siteEntry?: { siteUrl: string; permissionLevel: string }[];
  };
  const usable = siteEntry.filter(
    (s) => s.permissionLevel !== 'siteUnverifiedUser' && s.siteUrl.includes(config.clientDomain)
  );
  // A domain property covers every protocol and subdomain, so it is preferred
  // over a single https:// prefix when both exist.
  cachedSite =
    usable.find((s) => s.siteUrl.startsWith('sc-domain:'))?.siteUrl ?? usable[0]?.siteUrl ?? null;
  return cachedSite;
}

export async function handler(event: {
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  const credentials = googleCredentials();
  if (!credentials) return json(200, { configured: false });

  const period = event.queryStringParameters?.period ?? '30d';
  const days = DAYS[period] ?? DAYS['30d'];
  const timeZone = reportTimeZone();
  const range = (offset: number) => ({
    startDate: dateIn(timeZone, LAG_DAYS + offset + days - 1),
    endDate: dateIn(timeZone, LAG_DAYS + offset),
  });

  try {
    const token = await googleAccessToken(credentials, SCOPE);
    const site = await findSite(token);
    if (!site) return json(200, { configured: false });

    const query = async (body: Record<string, unknown>): Promise<SearchRow[]> => {
      const res = await fetch(`${API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw Object.assign(new Error(`searchAnalytics ${res.status}`), { status: res.status });
      return ((await res.json()) as { rows?: SearchRow[] }).rows ?? [];
    };

    const [now, before, terms] = await Promise.all([
      query(range(0)),
      // "All" has no earlier period to set it against.
      period === 'all' ? Promise.resolve([]) : query(range(days)),
      query({ ...range(0), dimensions: ['query'], rowLimit: 15 }),
    ]);

    const totals = (rows: SearchRow[]) => ({
      clicks: rows[0]?.clicks ?? 0,
      impressions: rows[0]?.impressions ?? 0,
      position: rows[0] ? Math.round(rows[0].position * 10) / 10 : null,
    });

    return json(
      200,
      {
        configured: true,
        current: totals(now),
        previous: period === 'all' ? null : totals(before),
        queries: terms.map((r) => ({
          query: r.keys?.[0] ?? '',
          clicks: r.clicks,
          impressions: r.impressions,
          position: Math.round(r.position * 10) / 10,
        })),
      },
      { 'Cache-Control': 'private, max-age=900' }
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    console.error('Search Console error:', err instanceof Error ? err.message : err);
    // 403 covers both setup gaps: the API not enabled, or no access to the property.
    if (status === 403 || status === 404) return json(200, { configured: false });
    return json(502, { configured: true, error: 'Search data could not be loaded. Please try again shortly.' });
  }
}
