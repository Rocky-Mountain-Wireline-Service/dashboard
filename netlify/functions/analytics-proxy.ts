import { createSign } from 'node:crypto';
import { json, requireUser } from '../lib/auth';

/**
 * Reads the site's Google Analytics 4 property on the dashboard's behalf.
 *
 * GA4 has no public read API, so this signs in as a Google service account
 * that has been given Viewer access to the property. The key never reaches the
 * browser. Until the property and key are set it answers `configured: false`
 * rather than failing, so the dashboard can say what is missing.
 *
 * Env:
 *   GA4_PROPERTY_ID    numeric property ID (not the G-XXXX measurement ID)
 *   GA4_CLIENT_EMAIL   the service account's address
 *   GA4_PRIVATE_KEY    its private key, with newlines as \n
 *   GA4_TIMEZONE       optional; defaults to America/Denver
 *
 * Query: ?period=today|7d|30d
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** The events the website sends that mean someone tried to get in touch. */
const LEAD_EVENTS = ['generate_lead', 'contact_click', 'quote_cta_click'];

const PERIODS = {
  today: { days: 1 },
  '7d': { days: 7 },
  '30d': { days: 30 },
} as const;
type Period = keyof typeof PERIODS;

interface Row {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}
interface Report {
  rows?: Row[];
}

let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(clientEmail: string, privateKey: string): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status})`);

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

const num = (row: Row | undefined, i: number) => Number(row?.metricValues?.[i]?.value ?? 0) || 0;
const dim = (row: Row, i: number) => row.dimensionValues?.[i]?.value ?? '';

/**
 * With two date ranges GA4 appends a `dateRange` dimension to every row,
 * always last, valued `date_range_0` (current) or `date_range_1` (previous).
 */
const inRange = (rows: Row[] | undefined, index: 0 | 1) =>
  (rows ?? []).filter((r) => r.dimensionValues?.at(-1)?.value === `date_range_${index}`);

/** YYYY-MM-DD for `daysAgo` days before today, in the property's timezone. */
function dateIn(timeZone: string, daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(d);
}

export async function handler(event: {
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  const propertyId = process.env.GA4_PROPERTY_ID;
  const clientEmail = process.env.GA4_CLIENT_EMAIL;
  const privateKey = process.env.GA4_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!propertyId || !clientEmail || !privateKey) {
    return json(200, { configured: false });
  }

  const requested = event.queryStringParameters?.period ?? '30d';
  const period: Period = requested in PERIODS ? (requested as Period) : '30d';
  const { days } = PERIODS[period];
  const timeZone = process.env.GA4_TIMEZONE || 'America/Denver';

  const ago = (n: number) => (n === 0 ? 'today' : `${n}daysAgo`);
  const current = { startDate: ago(days - 1), endDate: 'today' };
  const previous = { startDate: ago(days * 2 - 1), endDate: ago(days) };
  const hourly = period === 'today';

  const requests = [
    // 0 — headline totals, this period against the one before it
    {
      dateRanges: [current, previous],
      metrics: [
        { name: 'activeUsers' },
        { name: 'screenPageViews' },
        { name: 'sessions' },
        { name: 'averageSessionDuration' },
      ],
    },
    // 1 — visitors over time
    {
      dateRanges: [current],
      dimensions: [{ name: hourly ? 'hour' : 'date' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 100,
    },
    // 2 — most visited pages
    {
      dateRanges: [current],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 20,
    },
    // 3 — where visits came from
    {
      dateRanges: [current],
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [{ name: 'activeUsers' }],
      orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
      limit: 12,
    },
    // 4 — enquiries: form submissions and taps on a phone number, email or button
    {
      dateRanges: [current, previous],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: LEAD_EVENTS } },
      },
    },
  ];

  try {
    const token = await accessToken(clientEmail, privateKey);
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:batchRunReports`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      console.error('GA4 Data API error:', res.status, detail.slice(0, 500));
      // 403 is nearly always the service account not having been added to the
      // property, which is a setup step rather than an outage.
      return json(res.status === 403 ? 200 : 502, {
        configured: res.status !== 403,
        error:
          res.status === 403
            ? 'The analytics account has not been given access to this Google Analytics property.'
            : 'Google Analytics did not respond. Please try again shortly.',
      });
    }

    const { reports = [] } = (await res.json()) as { reports?: Report[] };
    const [totals, series, pages, sources, events] = reports;

    const totalsFor = (index: 0 | 1) => {
      const row = inRange(totals?.rows, index)[0];
      const eventRows = inRange(events?.rows, index);
      const count = (name: string) => num(eventRows.find((r) => dim(r, 0) === name), 0);
      return {
        visitors: num(row, 0),
        pageviews: num(row, 1),
        sessions: num(row, 2),
        avgSessionSeconds: Math.round(num(row, 3)),
        formSubmissions: count('generate_lead'),
        contactClicks: count('contact_click'),
        ctaClicks: count('quote_cta_click'),
      };
    };

    // GA4 omits periods with no traffic, which would draw a quiet day as a gap
    // in the chart instead of as a zero. Every expected slot is emitted.
    const byKey = new Map((series?.rows ?? []).map((r) => [dim(r, 0), num(r, 0)]));
    const points = hourly
      ? Array.from({ length: 24 }, (_, h) => ({
          key: String(h).padStart(2, '0'),
          visitors: byKey.get(String(h).padStart(2, '0')) ?? byKey.get(String(h)) ?? 0,
        }))
      : Array.from({ length: days }, (_, i) => {
          const key = dateIn(timeZone, days - 1 - i);
          return { key, visitors: byKey.get(key.replace(/-/g, '')) ?? 0 };
        });

    return json(
      200,
      {
        configured: true,
        period,
        unit: hourly ? 'hour' : 'day',
        current: totalsFor(0),
        previous: totalsFor(1),
        series: points,
        pages: (pages?.rows ?? []).map((r) => ({
          path: dim(r, 0),
          visitors: num(r, 0),
          pageviews: num(r, 1),
        })),
        sources: (sources?.rows ?? []).map((r) => ({
          source: dim(r, 0),
          medium: dim(r, 1),
          visitors: num(r, 0),
        })),
      },
      // Per-user and brief: GA4's own figures settle over minutes, not seconds.
      { 'Cache-Control': 'private, max-age=300' }
    );
  } catch (err) {
    console.error('Analytics proxy error:', err instanceof Error ? err.message : err);
    return json(502, { configured: true, error: 'Analytics could not be loaded. Please try again shortly.' });
  }
}
