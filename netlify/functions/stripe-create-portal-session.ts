import { json, requireUser } from '../lib/auth';
import { billingContext } from '../lib/stripe';

/**
 * Opens Stripe's hosted customer portal, where the card, the plan and past
 * invoices are managed. The portal has to be switched on once in the Stripe
 * dashboard (Settings → Billing → Customer portal) before this will work.
 */
export async function handler(event: {
  httpMethod: string;
  body: string | null;
  headers: Record<string, string>;
}) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  const ctx = billingContext();
  if (!ctx) return json(503, { error: 'Billing is not set up yet.' });

  // Only ever back to this dashboard. A return address taken from the request
  // would let a crafted link bounce someone from Stripe to any site.
  const requested = event.headers.origin || '';
  const isLocal = /^http:\/\/localhost(:\d+)?$/.test(requested);
  const origin = isLocal || requested === process.env.URL ? requested : process.env.URL || '';
  if (!origin) return json(400, { error: 'Missing origin.' });

  try {
    const session = await ctx.stripe.billingPortal.sessions.create({
      customer: ctx.customerId,
      return_url: `${origin.replace(/\/$/, '')}/billing`,
    });
    return json(200, { success: true, url: session.url });
  } catch (err) {
    console.error('Portal session error:', err instanceof Error ? err.message : err);
    return json(502, { error: 'The billing portal could not be opened. Please try again shortly.' });
  }
}
