import { json, requireUser } from '../lib/auth';
import { tursoClient } from '../lib/turso';
import config from '../../src/config/dashboard';

/** The most recent Lighthouse test, for the overview. */
export async function handler(event: { headers: Record<string, string> }) {
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  const db = tursoClient();
  if (!db) return json(200, { lighthouse: null });

  try {
    const row = (
      await db.execute({
        sql: `SELECT data FROM site_checks WHERE client_id = ? AND kind = 'lighthouse'
               ORDER BY checked_at DESC LIMIT 1`,
        args: [config.clientId],
      })
    ).rows[0];
    return json(200, { lighthouse: row ? JSON.parse(String(row.data)) : null });
  } catch (err) {
    console.error('site-health failed:', err instanceof Error ? err.message : err);
    return json(500, { error: 'Site health could not be loaded.' });
  }
}
