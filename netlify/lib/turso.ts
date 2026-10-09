// The /web build talks HTTP only, so there is no native binary for the function
// bundler to trip over.
import { createClient, type Client } from '@libsql/client/web';

/**
 * The agency database. It holds every client's records, so anything that
 * queries it from this dashboard must filter by this dashboard's own client ID
 * — never by an ID taken from a request.
 *
 * Env: TURSO_CONFIG = {"databaseUrl":"…","authToken":"…"}
 * (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN are still read, for older setups.)
 */
export function tursoClient(): Client | null {
  let config: { databaseUrl?: string; authToken?: string } = {};
  try {
    config = JSON.parse(process.env.TURSO_CONFIG || '{}');
  } catch {
    // Malformed JSON is the same as not configured.
  }
  const url = config.databaseUrl || process.env.TURSO_DATABASE_URL;
  const authToken = config.authToken || process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return null;
  return createClient({ url, authToken });
}
