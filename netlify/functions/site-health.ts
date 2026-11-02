import { json, requireUser } from '../lib/auth';
import { latestLighthouse } from '../lib/lighthouse';
import { pipelineConfigured } from '../lib/pipeline';

/** The most recent Lighthouse test, for the overview. */
export async function handler(event: { headers: Record<string, string> }) {
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  if (!pipelineConfigured()) return json(200, { lighthouse: null });

  try {
    return json(200, { lighthouse: await latestLighthouse() });
  } catch (err) {
    console.error('site-health failed:', err instanceof Error ? err.message : err);
    return json(500, { error: 'Site health could not be loaded.' });
  }
}
