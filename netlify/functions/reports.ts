import { json, requireUser } from '../lib/auth';
import { tursoClient } from '../lib/turso';
import config from '../../src/config/dashboard';

/**
 * Reads the stored monthly reports.
 *
 *   GET              the newest report, plus the list of months available
 *   GET ?month=…     a particular month (YYYY-MM)
 *
 * Also returns the web team's own write-up for that month when one has been
 * published in the agency's monthly_reports table. Read only: that table
 * belongs to the agency's tools, and nothing here writes to it.
 */
export async function handler(event: {
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
}) {
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  const db = tursoClient();
  if (!db) return json(200, { configured: false });

  const requested = event.queryStringParameters?.month ?? '';
  const month = /^\d{4}-\d{2}$/.test(requested) ? requested : null;

  try {
    const months = (
      await db.execute({
        sql: 'SELECT month FROM site_reports WHERE client_id = ? ORDER BY month DESC',
        args: [config.clientId],
      })
    ).rows.map((r) => String(r.month));

    const chosen = month && months.includes(month) ? month : months[0];
    if (!chosen) return json(200, { configured: true, report: null, months: [] });

    const [report, notes] = await Promise.all([
      db.execute({
        sql: 'SELECT data, generated_at FROM site_reports WHERE client_id = ? AND month = ?',
        args: [config.clientId, chosen],
      }),
      db
        .execute({
          sql: `SELECT summary, recommendations FROM monthly_reports
                 WHERE client_id = ? AND report_month = ? AND status = 'published'
                 ORDER BY published_at DESC LIMIT 1`,
          args: [config.clientId, chosen],
        })
        // The agency table is optional here: a report shows without its notes.
        .catch(() => null),
    ]);

    const row = report.rows[0];
    const note = notes?.rows[0];
    return json(200, {
      configured: true,
      months,
      report: JSON.parse(String(row.data)),
      notes:
        note && (note.summary || note.recommendations)
          ? { summary: note.summary ?? '', recommendations: note.recommendations ?? '' }
          : null,
    });
  } catch (err) {
    console.error('reports failed:', err instanceof Error ? err.message : err);
    return json(500, { error: 'The report could not be loaded. Please try again.' });
  }
}
