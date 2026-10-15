import type { Client } from '@libsql/client/web';
import { googleAccessToken, googleCredentials, reportTimeZone } from './google';
import { cleanPath, mergePaths, servicesFrom } from './paths';
import config from '../../src/config/dashboard';
import { firstLighthouse, type LighthouseCheck } from './lighthouse';

/**
 * The monthly report: a snapshot of one finished calendar month.
 *
 * Built once, after the month is over, and stored. A report that recalculated
 * every time it was opened would quietly change as Google revised its figures,
 * and "what did September look like" should have one answer.
 *
 * Every source is optional. A report without Search Console simply has no
 * search section; one without Google Analytics still counts inquiries from the
 * submissions inbox.
 */

export interface MonthlyReport {
  month: string;
  generatedAt: string;
  traffic: {
    visits: number;
    prevVisits: number;
    lastYearVisits: number | null;
    allVisits: number;
    avgSeconds: number;
    mobileShare: number | null;
    returningShare: number | null;
  } | null;
  /** Real visits per day of the month. */
  series: { day: string; visits: number }[];
  inquiries: {
    contactForms: number;
    applications: number;
    prevContactForms: number;
    prevApplications: number;
    /** Of this month's submissions, how many nobody has picked up yet. */
    stillNew: number;
    /** Null until the site sends tap events, so "not measured" never reads as zero. */
    phoneEmailTaps: number | null;
  };
  pages: { path: string; visits: number }[];
  services: { name: string; visits: number }[];
  cities: { name: string; region: string; visits: number }[];
  sources: { source: string; medium: string; visits: number }[];
  search: {
    clicks: number;
    impressions: number;
    position: number | null;
    prevClicks: number;
    queries: { query: string; clicks: number; impressions: number; position: number }[];
  } | null;
  /**
   * The first Lighthouse test taken during the month — normally the scheduled
   * one on the 2nd. Each month therefore shows the site as it stood going into
   * that month, so a site that changes mid-month shows the change in the next
   * month's report: a clean before and after. There is no way to test a past
   * date, so months before the first test have none.
   */
  lighthouse: LighthouseCheck | null;
  highlights: string[];
}

// ─── Dates ──────────────────────────────────────────────────────────────────

/** First and last day of a YYYY-MM month, as YYYY-MM-DD. */
export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(new Date(Date.UTC(y, m - 1, 1))), end: iso(new Date(Date.UTC(y, m, 0))) };
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** The month before the current one, in the report's timezone. */
export function lastCompleteMonth(now = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: reportTimeZone() }).format(now);
  return shiftMonth(today.slice(0, 7), -1);
}

/**
 * Midnight at the start of a local date, as the UTC timestamp the database
 * stores. A month of submissions is counted in Colorado time, not UTC, or a
 * Friday-evening application would land in the next month.
 */
export function localMidnightUtc(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: reportTimeZone(),
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value])
  );
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(guess - (asLocal - guess)).toISOString().slice(0, 19).replace('T', ' ');
}

// ─── Google Analytics ───────────────────────────────────────────────────────

interface Row {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}
const num = (row: Row | undefined, i: number) => Number(row?.metricValues?.[i]?.value ?? 0) || 0;
const dim = (row: Row, i: number) => row.dimensionValues?.[i]?.value ?? '';
const inRange = (rows: Row[] | undefined, i: number) =>
  (rows ?? []).filter((r) => r.dimensionValues?.at(-1)?.value === `date_range_${i}`);

async function analytics(month: string) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const credentials = googleCredentials();
  if (!propertyId || !credentials) return null;

  const range = (m: string) => {
    const { start, end } = monthBounds(m);
    return { startDate: start, endDate: end };
  };
  const current = range(month);
  const previous = range(shiftMonth(month, -1));
  const lastYear = range(shiftMonth(month, -12));

  // Engaged sessions throughout, for the reason given in the analytics function:
  // most raw sessions on this site are automated.
  const visits = { name: 'engagedSessions' };
  const byVisits = [{ metric: { metricName: 'engagedSessions' }, desc: true }];
  const usOnly = { filter: { fieldName: 'country', stringFilter: { value: 'United States' } } };

  const batches = [
    [
      { dateRanges: [current, previous, lastYear], metrics: [visits, { name: 'sessions' }, { name: 'userEngagementDuration' }] },
      { dateRanges: [current], dimensions: [{ name: 'date' }], metrics: [visits], limit: 40 },
      { dateRanges: [current], dimensions: [{ name: 'pagePath' }], metrics: [visits], orderBys: byVisits, limit: 100 },
      { dateRanges: [current], dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }], metrics: [visits], orderBys: byVisits, limit: 15 },
      { dateRanges: [current], dimensions: [{ name: 'city' }, { name: 'region' }], metrics: [visits], dimensionFilter: usOnly, orderBys: byVisits, limit: 10 },
    ],
    [
      { dateRanges: [current], dimensions: [{ name: 'deviceCategory' }], metrics: [visits] },
      { dateRanges: [current], dimensions: [{ name: 'newVsReturning' }], metrics: [visits] },
      {
        dateRanges: [current],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: ['contact_click', 'generate_lead'] } } },
      },
    ],
  ];

  const token = await googleAccessToken(credentials, 'https://www.googleapis.com/auth/analytics.readonly');
  const responses = await Promise.all(
    batches.map((requests) =>
      fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:batchRunReports`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      })
    )
  );
  const failed = responses.find((r) => !r.ok);
  if (failed) throw new Error(`GA4 Data API ${failed.status}: ${(await failed.text()).slice(0, 200)}`);

  const [a, b] = (await Promise.all(responses.map((r) => r.json()))) as { reports?: { rows?: Row[] }[] }[];
  const [totals, series, pages, sources, cities] = a.reports ?? [];
  const [devices, audience, events] = b.reports ?? [];

  const total = (i: number) => inRange(totals?.rows, i)[0];
  const engaged = num(total(0), 0);
  const share = (rows: Row[] | undefined, name: string) => {
    const all = (rows ?? []).reduce((sum, r) => sum + num(r, 0), 0);
    const part = num((rows ?? []).find((r) => dim(r, 0) === name), 0);
    return all ? Math.round((part / all) * 100) : null;
  };

  const byDay = new Map((series?.rows ?? []).map((r) => [dim(r, 0), num(r, 0)]));
  const { start, end } = monthBounds(month);
  const days: { day: string; visits: number }[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    days.push({ day, visits: byDay.get(day.replace(/-/g, '')) ?? 0 });
  }

  const mergedPages = mergePaths((pages?.rows ?? []).map((r) => ({ path: dim(r, 0), visits: num(r, 0) })));
  const eventCount = (name: string) => num((events?.rows ?? []).find((r) => dim(r, 0) === name), 0);
  // The site only started sending these when the rebuild went live. Any lead
  // event at all in the month means tracking was on.
  const tracked = (events?.rows ?? []).length > 0;

  return {
    traffic: {
      visits: engaged,
      prevVisits: num(total(1), 0),
      lastYearVisits: total(2) ? num(total(2), 0) : null,
      allVisits: num(total(0), 1),
      avgSeconds: engaged ? Math.round(num(total(0), 2) / engaged) : 0,
      mobileShare: share(devices?.rows, 'mobile'),
      returningShare: share(audience?.rows, 'returning'),
    },
    series: days,
    pages: [...mergedPages]
      .map(([path, count]) => ({ path: cleanPath(path), visits: count }))
      .filter((p) => p.visits > 0)
      .sort((x, y) => y.visits - x.visits)
      .slice(0, 8),
    services: servicesFrom(mergedPages, 6).map(({ name, visits: count }) => ({ name, visits: count })),
    cities: (cities?.rows ?? [])
      .map((r) => ({ name: dim(r, 0), region: dim(r, 1), visits: num(r, 0) }))
      .filter((c) => c.visits > 0 && c.name !== '(not set)')
      .slice(0, 6),
    sources: (sources?.rows ?? [])
      .map((r) => ({ source: dim(r, 0), medium: dim(r, 1), visits: num(r, 0) }))
      .filter((s) => s.visits > 0),
    phoneEmailTaps: tracked ? eventCount('contact_click') : null,
  };
}

// ─── Search Console ─────────────────────────────────────────────────────────

async function searchConsole(month: string) {
  const credentials = googleCredentials();
  if (!credentials) return null;

  const token = await googleAccessToken(credentials, 'https://www.googleapis.com/auth/webmasters.readonly');
  const api = 'https://www.googleapis.com/webmasters/v3';

  let site = process.env.GSC_SITE_URL;
  if (!site) {
    const res = await fetch(`${api}/sites`, { headers: { Authorization: `Bearer ${token}` } });
    // No access yet is normal until the client grants it; the report goes without.
    if (!res.ok) return null;
    const { siteEntry = [] } = (await res.json()) as { siteEntry?: { siteUrl: string; permissionLevel: string }[] };
    const usable = siteEntry.filter((s) => s.permissionLevel !== 'siteUnverifiedUser' && s.siteUrl.includes(config.clientDomain));
    site = usable.find((s) => s.siteUrl.startsWith('sc-domain:'))?.siteUrl ?? usable[0]?.siteUrl;
  }
  if (!site) return null;

  type SearchRow = { keys?: string[]; clicks: number; impressions: number; position: number };
  const query = async (m: string, dimensions?: string[]) => {
    const { start, end } = monthBounds(m);
    const res = await fetch(`${api}/sites/${encodeURIComponent(site!)}/searchAnalytics/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: start, endDate: end, ...(dimensions ? { dimensions, rowLimit: 10 } : {}) }),
    });
    if (!res.ok) throw new Error(`Search Console ${res.status}`);
    return ((await res.json()) as { rows?: SearchRow[] }).rows ?? [];
  };

  const [now, before, terms] = await Promise.all([query(month), query(shiftMonth(month, -1)), query(month, ['query'])]);
  return {
    clicks: now[0]?.clicks ?? 0,
    impressions: now[0]?.impressions ?? 0,
    position: now[0] ? Math.round(now[0].position * 10) / 10 : null,
    prevClicks: before[0]?.clicks ?? 0,
    queries: terms.map((r) => ({
      query: r.keys?.[0] ?? '',
      clicks: r.clicks,
      impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
    })),
  };
}

// ─── Submissions inbox ──────────────────────────────────────────────────────

async function inquiries(db: Client, month: string) {
  const count = async (m: string) => {
    const from = localMidnightUtc(monthBounds(m).start);
    const to = localMidnightUtc(monthBounds(shiftMonth(m, 1)).start);
    const rows = (
      await db.execute({
        sql: `SELECT kind, status, COUNT(*) AS n FROM form_submissions
               WHERE client_id = ? AND created_at >= ? AND created_at < ?
               GROUP BY kind, status`,
        args: [config.clientId, from, to],
      })
    ).rows;
    const sum = (pred: (r: (typeof rows)[number]) => boolean) =>
      rows.filter(pred).reduce((total, r) => total + (Number(r.n) || 0), 0);
    return {
      contact: sum((r) => r.kind === 'contact'),
      application: sum((r) => r.kind === 'application'),
      stillNew: sum((r) => r.status === 'new'),
    };
  };
  const [now, before] = await Promise.all([count(month), count(shiftMonth(month, -1))]);
  return { now, before };
}

// ─── Highlights ─────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function change(now: number, before: number): string {
  if (!before) return '';
  const pct = Math.round(((now - before) / before) * 100);
  if (Math.abs(pct) <= 5) return 'about the same as';
  return `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on`;
}

/** Three or four plain sentences: the things worth knowing about the month. */
function highlights(r: Omit<MonthlyReport, 'highlights'>, monthName: string): string[] {
  const out: string[] = [];
  const t = r.traffic;

  if (t) {
    const vsMonth = change(t.visits, t.prevVisits);
    const vsYear = t.lastYearVisits ? change(t.visits, t.lastYearVisits) : '';
    const comparisons = [vsMonth && `${vsMonth} the month before`, vsYear && `${vsYear} ${monthName} last year`].filter(Boolean);
    out.push(`${plural(t.visits, 'real visit', 'real visits')} in ${monthName}${comparisons.length ? `, ${comparisons.join(' and ')}` : ''}.`);
  }

  const e = r.inquiries;
  const sent = e.contactForms + e.applications;
  if (sent) {
    let line = `${plural(e.contactForms, 'sales inquiry', 'sales inquiries')} and ${plural(e.applications, 'job application', 'job applications')} came in through the website.`;
    if (e.stillNew) line += ` ${e.stillNew === 1 ? 'One is' : `${e.stillNew} are`} still marked New.`;
    out.push(line);
  } else {
    out.push('No forms were sent through the website this month.');
  }

  if (r.services[0] && r.services[0].visits >= 3) {
    out.push(`${r.services[0].name} was the service people looked at most.`);
  }
  if (r.search && r.search.clicks) {
    const top = r.search.queries[0];
    out.push(
      `Google sent ${plural(r.search.clicks, 'click', 'clicks')}${top ? `; the top search was “${top.query}”` : ''}.`
    );
  } else if (r.cities[0]) {
    out.push(`Most visits came from around ${r.cities[0].name}, ${r.cities[0].region}.`);
  }
  const mobile = r.lighthouse?.mobile;
  if (mobile) {
    const verdict = mobile.scores.performance >= 90 ? 'fast' : mobile.scores.performance >= 50 ? 'reasonably quick' : 'slow';
    out.push(`On a phone the homepage scored ${mobile.scores.performance} out of 100 for speed in Google's test: ${verdict}.`);
  }
  return out.slice(0, 5);
}

// ─── Build and store ────────────────────────────────────────────────────────

export async function buildReport(db: Client, month: string): Promise<MonthlyReport> {
  // A failure in one source leaves its section empty rather than losing the
  // whole month; the reason is in the function log.
  const settle = async <T>(label: string, task: Promise<T>): Promise<T | null> => {
    try {
      return await task;
    } catch (err) {
      console.error(`Monthly report ${month}: ${label} failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  };
  const { start: lighthouseFrom, end: lighthouseTo } = monthBounds(month);

  const [ga, search, forms, lighthouse] = await Promise.all([
    settle('analytics', analytics(month)),
    settle('search', searchConsole(month)),
    inquiries(db, month),
    settle('lighthouse', firstLighthouse(db, lighthouseFrom, lighthouseTo)),
  ]);

  const base: Omit<MonthlyReport, 'highlights'> = {
    month,
    generatedAt: new Date().toISOString(),
    traffic: ga?.traffic ?? null,
    series: ga?.series ?? [],
    inquiries: {
      contactForms: forms.now.contact,
      applications: forms.now.application,
      prevContactForms: forms.before.contact,
      prevApplications: forms.before.application,
      stillNew: forms.now.stillNew,
      phoneEmailTaps: ga?.phoneEmailTaps ?? null,
    },
    pages: ga?.pages ?? [],
    services: ga?.services ?? [],
    cities: ga?.cities ?? [],
    sources: ga?.sources ?? [],
    search,
    lighthouse: lighthouse ?? null,
  };
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  return { ...base, highlights: highlights(base, monthName) };
}

export async function reportExists(db: Client, month: string): Promise<boolean> {
  const row = (
    await db.execute({ sql: 'SELECT 1 FROM site_reports WHERE client_id = ? AND month = ?', args: [config.clientId, month] })
  ).rows[0];
  return Boolean(row);
}

export async function saveReport(db: Client, report: MonthlyReport): Promise<void> {
  await db.execute({
    sql: `INSERT INTO site_reports (client_id, month, data, generated_at)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT (client_id, month) DO UPDATE SET data = excluded.data, generated_at = excluded.generated_at`,
    args: [config.clientId, report.month, JSON.stringify(report)],
  });
}
