import { json, requireUser } from '../lib/auth';
import { pipeline, pipelineConfigured } from '../lib/pipeline';

/**
 * Reads the stored monthly reports, through the Pipeline (client-site-data)
 * with this dashboard's key.
 *
 *   GET              the newest report, plus the list of months available
 *   GET ?month=…     a particular month (YYYY-MM)
 *
 * Also returns the web team's own write-up for that month when one has been
 * published in the agency's monthly_reports table.
 */
export async function handler(event: {
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  if (!pipelineConfigured()) return json(200, { configured: false });

  const requested = event.queryStringParameters?.month ?? '';
  const params = new URLSearchParams({ resource: 'reports' });
  if (/^\d{4}-\d{2}$/.test(requested)) params.set('month', requested);

  try {
    const data = await pipeline<{ months: string[]; report: unknown; notes: unknown }>(`client-site-data?${params}`);
    return json(200, { configured: true, months: data.months, report: data.report, notes: data.notes ?? null });
  } catch (err) {
    console.error('reports failed:', err instanceof Error ? err.message : err);
    return json(500, { error: 'The report could not be loaded. Please try again.' });
  }
}
