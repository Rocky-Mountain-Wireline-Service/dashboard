import { tursoClient } from '../lib/turso';
import { buildReport, lastCompleteMonth, reportExists, saveReport } from '../lib/report';

/**
 * Writes last month's report, once, on the 3rd of each month.
 *
 * The 3rd rather than the 1st because Google is still settling the last days
 * of a month for a day or two (Search Console runs about two days behind), and
 * a snapshot taken too early would be short.
 *
 * A month that already has a report is left alone, so a retried or repeated
 * run never rewrites what the client has already seen. To rebuild one on
 * purpose, use `pnpm reports:generate`.
 *
 * Scheduled functions run only on the published production deploy.
 */
export default async () => {
  const db = tursoClient();
  if (!db) {
    console.error('Monthly report skipped: TURSO_CONFIG is not set.');
    return new Response('not configured', { status: 500 });
  }

  const month = lastCompleteMonth();
  if (await reportExists(db, month)) {
    console.log(`Monthly report ${month} already exists; left as it is.`);
    return new Response('exists');
  }

  const report = await buildReport(db, month);
  await saveReport(db, report);
  console.log(`Monthly report ${month} written.`);
  return new Response('written');
};

// 14:00 UTC on the 3rd: early morning in Colorado.
export const config = { schedule: '0 14 3 * *' };
