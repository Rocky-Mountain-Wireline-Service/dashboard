import Stripe from 'stripe';
import { requireUser } from '../lib/auth';

interface RequestBody {
  customerId?: string;
  returnUrl: string;
}

export async function handler(event: { body: string | null; headers: Record<string, string> }) {
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  if (event.body === null) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body' }) };
  }

  const stripeConfig = process.env.STRIPE_CONFIG;
  if (!stripeConfig) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe not configured' }) };
  }

  try {
    const { secretKey } = JSON.parse(stripeConfig);
    const stripe = new Stripe(secretKey);
    const { returnUrl } = JSON.parse(event.body) as RequestBody;

    // The customer is fixed on the server. Taking it from the request would let
    // any signed-in user open the billing portal of any customer ID they typed.
    const customerId = process.env.STRIPE_CUSTOMER_ID;
    if (!customerId) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Billing is not configured' }) };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || process.env.URL || 'https://localhost:8888/billing',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, url: session.url }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Portal session error:', message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
}
