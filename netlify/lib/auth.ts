/**
 * Who is calling, verified with Auth0 rather than taken on trust.
 *
 * The functions used to accept any request that carried an Authorization
 * header at all, so `Authorization: x` was enough to read billing data. The
 * dashboard's token is an opaque Auth0 access token, which cannot be checked
 * locally — so it is presented to Auth0's /userinfo endpoint, which answers
 * only for a token it issued and has not expired.
 *
 * ALLOWED_EMAILS narrows this further to named people: a comma-separated list
 * of addresses and/or `@domain.com` entries. Without it, any account in the
 * Auth0 tenant is let in, which is only safe while sign-ups are disabled there.
 */

export interface DashboardUser {
  sub: string;
  email?: string;
  name?: string;
}

interface UserInfo extends DashboardUser {
  email_verified?: boolean;
}

export interface FunctionResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

export const json = (
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): FunctionResponse => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  body: JSON.stringify(body),
});

// A warm function instance serves several requests; re-asking Auth0 for each
// one would spend its rate limit on a token it validated seconds ago.
const CACHE_MS = 5 * 60 * 1000;
const verified = new Map<string, { user: UserInfo; expires: number }>();

function isAllowed(user: UserInfo): boolean {
  const rules = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (!rules.length) return true;

  const email = user.email?.toLowerCase();
  // An unverified address proves nothing about who owns it.
  if (!email || user.email_verified === false) return false;
  return rules.some((rule) => (rule.startsWith('@') ? email.endsWith(rule) : email === rule));
}

async function lookUp(token: string): Promise<UserInfo | null> {
  const hit = verified.get(token);
  if (hit && hit.expires > Date.now()) return hit.user;

  const domain = process.env.AUTH0_DOMAIN || process.env.VITE_AUTH0_DOMAIN;
  if (!domain) throw new Error('AUTH0_DOMAIN is not set');

  const res = await fetch(`https://${domain}/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const user = (await res.json()) as UserInfo;
  if (!user?.sub) return null;

  if (verified.size > 200) verified.clear();
  verified.set(token, { user, expires: Date.now() + CACHE_MS });
  return user;
}

/**
 * Returns the caller, or the response to send instead. Use as:
 *
 *   const auth = await requireUser(event.headers);
 *   if ('response' in auth) return auth.response;
 */
export async function requireUser(
  headers: Record<string, string | undefined> | null | undefined
): Promise<{ user: DashboardUser } | { response: FunctionResponse }> {
  const header = headers?.authorization || headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { response: json(401, { error: 'Sign in to continue.' }) };

  let user: UserInfo | null;
  try {
    user = await lookUp(token);
  } catch (err) {
    console.error('Auth check failed:', err instanceof Error ? err.message : err);
    return { response: json(500, { error: 'Sign-in could not be verified. Please try again.' }) };
  }

  if (!user) return { response: json(401, { error: 'Your session has expired. Please sign in again.' }) };
  if (!isAllowed(user)) {
    return { response: json(403, { error: 'This account does not have access to the dashboard.' }) };
  }

  return { user: { sub: user.sub, email: user.email, name: user.name } };
}
