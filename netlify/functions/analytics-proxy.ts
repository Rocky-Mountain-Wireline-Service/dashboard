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
 * Query: ?period=7d|30d|13w
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** The events the website sends that mean someone tried to get in touch. */
const LEAD_EVENTS = ['generate_lead', 'contact_click', 'quote_cta_click'];

/** `weeks` periods are charted as weekly totals; a bar a day is noise at that length. */
const PERIODS = {
  '7d': { days: 7, weekly: false },
  '30d': { days: 30, weekly: false },
  '13w': { days: 91, weekly: true },
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
  const { days, weekly } = PERIODS[period];
  const timeZone = process.env.GA4_TIMEZONE || 'America/Denver';

  const ago = (n: number) => (n === 0 ? 'today' : `${n}daysAgo`);
  const current = { startDate: ago(days - 1), endDate: 'today' };
  const previous = { startDate: ago(days * 2 - 1), endDate: ago(days) };

  /*
    Everything is counted in ENGAGED sessions: visits that lasted ten seconds,
    opened a second page, or got in touch.

    Raw visitor counts are not usable for this site. Well over half of its
    sessions are automated — a steady stream from Singapore and from cloud
    data centres that loads one page and leaves within a second. Counted as
    "visitors" they more than doubled every figure and buried the real pattern
    (they also all arrive as "Direct", so they distorted the sources most).
    Engagement is GA4's own test for a person, and it removes nearly all of it.
  */
  const visits = { name: 'engagedSessions' };
  const byVisits = [{ metric: { metricName: 'engagedSessions' }, desc: true }];
  const leadFilter = {
    filter: { fieldName: 'eventName', inListFilter: { values: LEAD_EVENTS } },
  };

  // GA4 accepts five reports per batch, so they go as two batches side by side.
  const batchA = [
    // 0 — totals, this period against the one before it
    {
      dateRanges: [current, previous],
      metrics: [visits, { name: 'sessions' }, { name: 'userEngagementDuration' }],
    },
    // 1 — engaged visits per day
    { dateRanges: [current], dimensions: [{ name: 'date' }], metrics: [visits], limit: 100 },
    // 2 — pages people actually read
    { dateRanges: [current], dimensions: [{ name: 'pagePath' }], metrics: [visits], orderBys: byVisits, limit: 40 },
    // 3 — where engaged visits came from
    {
      dateRanges: [current],
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [visits],
      orderBys: byVisits,
      limit: 15,
    },
    // 4 — enquiries, by the page they were sent from (contact vs. employment)
    {
      dateRanges: [current, previous],
      dimensions: [{ name: 'eventName' }, { name: 'pagePath' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: leadFilter,
      limit: 200,
    },
  ];
  const batchB = [
    // 0 — which states the visits are in
    {
      dateRanges: [current],
      dimensions: [{ name: 'region' }],
      metrics: [visits],
      dimensionFilter: { filter: { fieldName: 'country', stringFilter: { value: 'United States' } } },
      orderBys: byVisits,
      limit: 9,
    },
    // 1 — phone or desk
    { dateRanges: [current], dimensions: [{ name: 'deviceCategory' }], metrics: [visits] },
    // 2 — has the site ever sent an enquiry event? Until the rebuilt site is
    //     live it has not, and a zero then means "not measured", not "none".
    {
      dateRanges: [{ startDate: '180daysAgo', endDate: 'today' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: leadFilter,
    },
  ];

  try {
    const token = await accessToken(clientEmail, privateKey);
    const run = (requests: unknown[]) =>
      fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:batchRunReports`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
        }
      );
    const responses = await Promise.all([run(batchA), run(batchB)]);

    const failed = responses.find((r) => !r.ok);
    if (failed) {
      const detail = await failed.text();
      console.error('GA4 Data API error:', failed.status, detail.slice(0, 500));
      // 403 is nearly always the service account not having been added to the
      // property, which is a setup step rather than an outage.
      return json(failed.status === 403 ? 200 : 502, {
        configured: failed.status !== 403,
        error:
          failed.status === 403
            ? 'The analytics account has not been given access to this Google Analytics property.'
            : 'Google Analytics did not respond. Please try again shortly.',
      });
    }

    const [a, b] = (await Promise.all(responses.map((r) => r.json()))) as { reports?: Report[] }[];
    const [totals, series, pages, sources, events] = a.reports ?? [];
    const [states, devices, everTracked] = b.reports ?? [];

    /** `/contact/` and `/contact` are one page; the old site used the first form, the rebuilt one the second. */
    const cleanPath = (path: string) => path.split('?')[0].replace(/(.)\/+$/, '$1') || '/';

    const totalsFor = (index: 0 | 1) => {
      const row = inRange(totals?.rows, index)[0];
      const eventRows = inRange(events?.rows, index);
      const count = (name: string, onPage?: (path: string) => boolean) =>
        eventRows
          .filter((r) => dim(r, 0) === name && (!onPage || onPage(cleanPath(dim(r, 1)))))
          .reduce((sum, r) => sum + num(r, 0), 0);
      const isJobs = (path: string) => path.startsWith('/employment');
      const engaged = num(row, 0);
      return {
        visits: engaged,
        allVisits: num(row, 1),
        avgSeconds: engaged ? Math.round(num(row, 2) / engaged) : 0,
        contactForms: count('generate_lead', (p) => !isJobs(p)),
        applications: count('generate_lead', isJobs),
        contactClicks: count('contact_click'),
        ctaClicks: count('quote_cta_click'),
      };
    };

    // GA4 omits days with no traffic, which would draw a quiet day as a gap in
    // the chart instead of as a zero. Every expected day is emitted.
    const byDate = new Map((series?.rows ?? []).map((r) => [dim(r, 0), num(r, 0)]));
    const daily = Array.from({ length: days }, (_, i) => {
      const key = dateIn(timeZone, days - 1 - i);
      return { key, visits: byDate.get(key.replace(/-/g, '')) ?? 0 };
    });
    const points = weekly
      ? Array.from({ length: days / 7 }, (_, w) => {
          const week = daily.slice(w * 7, w * 7 + 7);
          return { key: week[0].key, visits: week.reduce((sum, d) => sum + d.visits, 0) };
        })
      : daily;

    const mergedPages = new Map<string, number>();
    for (const r of pages?.rows ?? []) {
      const path = cleanPath(dim(r, 0));
      mergedPages.set(path, (mergedPages.get(path) ?? 0) + num(r, 0));
    }

    const deviceCount = (name: string) =>
      num((devices?.rows ?? []).find((r) => dim(r, 0) === name), 0);

    return json(
      200,
      {
        configured: true,
        period,
        unit: weekly ? 'week' : 'day',
        current: totalsFor(0),
        previous: totalsFor(1),
        trackingActive: num(everTracked?.rows?.[0], 0) > 0,
        series: points,
        pages: [...mergedPages]
          .map(([path, count]) => ({ path, visits: count }))
          .filter((p) => p.visits > 0)
          .sort((x, y) => y.visits - x.visits)
          .slice(0, 10),
        sources: (sources?.rows ?? [])
          .map((r) => ({ source: dim(r, 0), medium: dim(r, 1), visits: num(r, 0) }))
          .filter((s) => s.visits > 0),
        states: (states?.rows ?? [])
          .map((r) => ({ name: dim(r, 0), visits: num(r, 0) }))
          .filter((s) => s.visits > 0 && s.name && s.name !== '(not set)')
          .slice(0, 8),
        devices: {
          mobile: deviceCount('mobile'),
          desktop: deviceCount('desktop'),
          tablet: deviceCount('tablet'),
        },
      },
      // Per-user and brief: GA4's own figures settle over minutes, not seconds.
      { 'Cache-Control': 'private, max-age=300' }
    );
  } catch (err) {
    console.error('Analytics proxy error:', err instanceof Error ? err.message : err);
    return json(502, { configured: true, error: 'Analytics could not be loaded. Please try again shortly.' });
  }
}
