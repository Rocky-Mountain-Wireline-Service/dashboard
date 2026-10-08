import { useApi } from '@/composables/useApi';

/** Runs a GROQ query through the server-side proxy. Call from `setup`. */
export function useSanity() {
  const api = useApi();

  return async function query<T = unknown>(groq: string, params?: Record<string, unknown>): Promise<T> {
    const res = await api('sanity-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: groq, params }),
    });
    if (!res.ok) throw new Error(`Sanity proxy error: ${res.status}`);
    return (await res.json()).result as T;
  };
}
