import { tursoClient } from '../lib/turso';
import { lighthouseConfigured, runLighthouse, saveLighthouse } from '../lib/lighthouse';

/**
 * Tests the live homepage with Google Lighthouse on the 2nd of each month. That
 * test is the one the month's own report shows (written on the 3rd of the
 * month after), so each report reflects the site going into its month.
 *
 * Separate from the report on purpose: each test can take most of the time a
 * scheduled function is allowed, and the report has its own work to do.
 * Scheduled functions run only on the published production deploy.
 */
export default async () => {
  if (!lighthouseConfigured()) {
    console.log('Lighthouse check skipped: no Google service account or PSI_API_KEY.');
    return new Response('not configured');
  }
  const db = tursoClient();
  if (!db) return new Response('database not configured', { status: 500 });

  const check = await runLighthouse();
  if (!check) return new Response('no result', { status: 502 });
  await saveLighthouse(db, check);
  console.log(`Lighthouse: mobile ${check.mobile?.scores.performance ?? '—'}, desktop ${check.desktop?.scores.performance ?? '—'}`);
  return new Response('saved');
};

// 14:00 UTC on the 2nd.
export const config = { schedule: '0 14 2 * *' };
