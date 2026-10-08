import { useAuth0 } from '@auth0/auth0-vue';

/**
 * Calls one of the dashboard's server functions as the signed-in user.
 *
 * Every function verifies the caller, so a bare `fetch` gets a 401. Sending
 * the token from one place means a new page cannot forget it. Call from
 * `setup`, like any composable.
 */
export function useApi() {
  const { getAccessTokenSilently } = useAuth0();

  return async function api(name: string, init: RequestInit = {}): Promise<Response> {
    const token = await getAccessTokenSilently();
    return fetch(`/.netlify/functions/${name}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  };
}
