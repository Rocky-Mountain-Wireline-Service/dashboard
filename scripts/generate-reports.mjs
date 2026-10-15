// Builds monthly reports by hand: to backfill past months, or to rebuild one.
//
//   pnpm reports:generate                  last complete month (dry run)
//   pnpm reports:generate 2026-09          one month (dry run)
//   pnpm reports:generate --last 12        the last 12 complete months
//   …add --write to save; an existing month is replaced.
//
// The report code is TypeScript shared with the Netlify functions, so it is
// loaded through Vite rather than duplicated here.
import { createServer, loadEnv } from 'vite';

const args = process.argv.slice(2);
const write = args.includes('--write');
const lastN = args.includes('--last') ? Number(args[args.indexOf('--last') + 1]) : 0;
const explicit = args.find((a) => /^\d{4}-\d{2}$/.test(a));

Object.assign(process.env, loadEnv('development', process.cwd(), ''));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const { tursoClient } = await vite.ssrLoadModule('/netlify/lib/turso.ts');
  const { buildReport, saveReport, lastCompleteMonth, shiftMonth } = await vite.ssrLoadModule('/netlify/lib/report.ts');
  const db = tursoClient();
  if (!db) throw new Error('TURSO_CONFIG is not set in .env');

  const latest = lastCompleteMonth();
  const months = explicit
    ? [explicit]
    : Array.from({ length: Math.max(1, lastN) }, (_, i) => shiftMonth(latest, -i)).reverse();

  for (const month of months) {
    const report = await buildReport(db, month);
    const t = report.traffic;
    const e = report.inquiries;
    console.log(
      `${month}: ${t ? `${t.visits} real visits (${t.prevVisits} the month before)` : 'no analytics'}, ` +
        `${e.contactForms} contact, ${e.applications} applications, search ${report.search ? 'yes' : 'no'}`
    );
    for (const line of report.highlights) console.log(`   · ${line}`);
    if (write) await saveReport(db, report);
  }
  console.log(write ? `\nSaved ${months.length} report(s).` : '\nDry run. Add --write to save.');
} finally {
  await vite.close();
}
