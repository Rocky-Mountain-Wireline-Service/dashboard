import { json, requireUser } from '../lib/auth';
import { cleanPath, mergePaths, servicesFrom } from '../lib/paths';
import { dateIn, googleAccessToken, googleCredentials, reportTimeZone } from '../lib/google';

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
 *   GA4_TIMEZONE       optional; defaults to America/Denver
 *   …plus the service account's credentials — see ../lib/google
 *
 * Query: ?period=7d|30d|13w|12m|all
 */

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** The events the website sends that mean someone tried to get in touch. */
const LEAD_EVENTS = ['generate_lead', 'contact_click', 'quote_cta_click'];

/**
 * Short periods are charted by day, a quarter by week, and anything longer by
 * calendar month. `months: null` means everything the property holds.
 */
const PERIODS = {
  '7d': { unit: 'day', days: 7 },
  '30d': { unit: 'day', days: 30 },
  '13w': { unit: 'week', days: 91 },
  '12m': { unit: 'month', months: 12 },
  all: { unit: 'month', months: null },
} as const;
type Period = keyof typeof PERIODS;

/** The earliest date GA4 accepts; "all time" simply starts here. */
const GA4_EPOCH = '2015-08-14';

/** First day of the month `back` months before the one containing `today` (YYYY-MM-DD). */
function monthStart(today: string, back: number): string {
  const [y, m] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10);
}
const dayBefore = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

interface Row {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}
interface Report {
  rows?: Row[];
}

const num = (row: Row | undefined, i: number) => Number(row?.metricValues?.[i]?.value ?? 0) || 0;
const dim = (row: Row, i: number) => row.dimensionValues?.[i]?.value ?? '';

/**
 * With two date ranges GA4 appends a `dateRange` dimension to every row,
 * always last, valued `date_range_0` (current) or `date_range_1` (previous).
 * With one range it adds nothing, and every row is the current period.
 */
const inRange = (rows: Row[] | undefined, index: number, compared: boolean) =>
  compared
    ? (rows ?? []).filter((r) => r.dimensionValues?.at(-1)?.value === `date_range_${index}`)
    : index === 0
      ? rows ?? []
      : [];

export async function handler(event: {
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  const propertyId = process.env.GA4_PROPERTY_ID;
  const credentials = googleCredentials();
  if (!propertyId || !credentials) {
    return json(200, { configured: false });
  }

  const requested = event.queryStringParameters?.period ?? '30d';
  const period: Period = requested in PERIODS ? (requested as Period) : '30d';
  const spec = PERIODS[period];
  const timeZone = reportTimeZone();
  const today = dateIn(timeZone);

  // The current range, and the equal-length one before it to compare against.
  // "All time" has nothing before it.
  let current: { startDate: string; endDate: string };
  let previous: { startDate: string; endDate: string } | null;
  // The same stretch a year earlier. Oilfield work is seasonal, so "against
  // last month" can show a dip that is only the calendar; this does not.
  let lastYear: { startDate: string; endDate: string } | null = null;
  if (spec.unit === 'month') {
    if (spec.months === null) {
      current = { startDate: GA4_EPOCH, endDate: 'today' };
      previous = null;
    } else {
      const start = monthStart(today, spec.months - 1);
      current = { startDate: start, endDate: 'today' };
      previous = { startDate: monthStart(today, spec.months * 2 - 1), endDate: dayBefore(start) };
    }
  } else {
    const ago = (n: number) => (n === 0 ? 'today' : `${n}daysAgo`);
    current = { startDate: ago(spec.days - 1), endDate: 'today' };
    previous = { startDate: ago(spec.days * 2 - 1), endDate: ago(spec.days) };
    lastYear = { startDate: ago(spec.days - 1 + 365), endDate: ago(365) };
  }
  const compared = previous !== null;
  const ranges = previous ? [current, previous] : [current];
  // Only the totals carry the year-ago range; GA4 allows four per report.
  const totalRanges = lastYear ? [...ranges, lastYear] : ranges;
  const lastYearIndex = lastYear ? totalRanges.length - 1 : -1;

  /*
    Everything is counted in ENGAGED sessions: visits that lasted ten seconds,
    opened a second page, or got in touch.

    Raw visitor counts are not usable for this site. Well over half of its
    sessions are automated — a steady stream from Singapore and from cloud
    data centers that loads one page and leaves within a second. Counted as
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
      dateRanges: totalRanges,
      metrics: [visits, { name: 'sessions' }, { name: 'userEngagementDuration' }],
    },
    // 1 — engaged visits over time
    {
      dateRanges: [current],
      dimensions: [{ name: spec.unit === 'month' ? 'yearMonth' : 'date' }],
      metrics: [visits],
      limit: 250,
    },
    // 2 — pages people actually read
    { dateRanges: [current], dimensions: [{ name: 'pagePath' }], metrics: [visits], orderBys: byVisits, limit: 100 },
    // 3 — where engaged visits came from
    {
      dateRanges: [current],
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [visits],
      orderBys: byVisits,
      limit: 15,
    },
    // 4 — inquiries, by the page they were sent from (contact vs. employment)
    {
      dateRanges: ranges,
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
    // 2 — towns and cities, which map onto branches better than states do
    {
      dateRanges: [current],
      dimensions: [{ name: 'city' }, { name: 'region' }],
      metrics: [visits],
      dimensionFilter: { filter: { fieldName: 'country', stringFilter: { value: 'United States' } } },
      orderBys: byVisits,
      limit: 14,
    },
    // 3 — first visit, or someone coming back
    { dateRanges: [current], dimensions: [{ name: 'newVsReturning' }], metrics: [visits] },
    // 4 — has the site ever sent an inquiry event? Until the rebuilt site is
    //     live it has not, and a zero then means "not measured", not "none".
    {
      dateRanges: [{ startDate: '180daysAgo', endDate: 'today' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: leadFilter,
    },
  ];

  try {
    const token = await googleAccessToken(credentials, SCOPE);
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
    const [states, devices, cities, audience, everTracked] = b.reports ?? [];

    const totalsFor = (index: 0 | 1) => {
      const row = inRange(totals?.rows, index, totalRanges.length > 1)[0];
      const eventRows = inRange(events?.rows, index, compared);
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

    // GA4 omits days and months with no traffic, which would draw a quiet one
    // as a gap in the chart instead of as a zero. Every expected slot is emitted.
    const byKey = new Map((series?.rows ?? []).map((r) => [dim(r, 0), num(r, 0)]));
    let points: { key: string; visits: number }[];
    if (spec.unit === 'month') {
      // "All time" starts at the first month that recorded anything.
      const first = [...byKey.keys()].sort()[0];
      const monthsBack =
        spec.months ??
        (first
          ? (Number(today.slice(0, 4)) - Number(first.slice(0, 4))) * 12 +
            (Number(today.slice(5, 7)) - Number(first.slice(4, 6))) + 1
          : 1);
      points = Array.from({ length: monthsBack }, (_, i) => {
        const key = monthStart(today, monthsBack - 1 - i).slice(0, 7);
        return { key, visits: byKey.get(key.replace('-', '')) ?? 0 };
      });
    } else {
      const daily = Array.from({ length: spec.days }, (_, i) => {
        const key = dateIn(timeZone, spec.days - 1 - i);
        return { key, visits: byKey.get(key.replace(/-/g, '')) ?? 0 };
      });
      points =
        spec.unit === 'week'
          ? Array.from({ length: spec.days / 7 }, (_, w) => {
              const week = daily.slice(w * 7, w * 7 + 7);
              return { key: week[0].key, visits: week.reduce((sum, d) => sum + d.visits, 0) };
            })
          : daily;
    }

    const mergedPages = mergePaths((pages?.rows ?? []).map((r) => ({ path: dim(r, 0), visits: num(r, 0) })));

    const services = servicesFrom(mergedPages);

    const audienceCount = (name: string) =>
      num((audience?.rows ?? []).find((r) => dim(r, 0) === name), 0);

    const deviceCount = (name: string) =>
      num((devices?.rows ?? []).find((r) => dim(r, 0) === name), 0);

    return json(
      200,
      {
        configured: true,
        period,
        unit: spec.unit,
        current: totalsFor(0),
        previous: compared ? totalsFor(1) : null,
        lastYear:
          lastYearIndex > 0
            ? { visits: num(inRange(totals?.rows, lastYearIndex, true)[0], 0) }
            : null,
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
        cities: (cities?.rows ?? [])
          .map((r) => ({ name: dim(r, 0), region: dim(r, 1), visits: num(r, 0) }))
          .filter((c) => c.visits > 0 && c.name && c.name !== '(not set)')
          .slice(0, 8),
        services,
        audience: { new: audienceCount('new'), returning: audienceCount('returning') },
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
