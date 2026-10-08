import { createClient } from '@sanity/client';
import { requireUser } from '../lib/auth';

const client = createClient({
  projectId: (process.env.NETLIFY_SANITY_PROJECT_ID || process.env.VITE_SANITY_PROJECT_ID)!,
  dataset: process.env.VITE_SANITY_DATASET || 'production',
  apiVersion: '2024-01-01',
  useCdn: true,
});

export async function handler(event: { body: string | null; headers: Record<string, string> }) {
  // An open GROQ proxy is a free query endpoint for anyone who finds the URL.
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body' }) };
  }

  try {
    const { query, params } = JSON.parse(event.body);
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing query' }) };
    }

    const result = await client.fetch(query, params || {});
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
}
