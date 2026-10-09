import Stripe from 'stripe';

/**
 * The Stripe client and the one customer this dashboard may show.
 *
 * Both come from the server's environment. The customer in particular is never
 * taken from a request: whoever is signed in sees this client's billing and
 * nobody else's, whatever ID a request names.
 *
 * Env:
 *   STRIPE_SECRET_KEY    a restricted key is enough — read access to customers,
 *                        subscriptions, invoices and products, write access to
 *                        customer portal sessions
 *   STRIPE_CUSTOMER_ID   cus_…
 *
 * STRIPE_CONFIG ({"secretKey":"…"}) is still read, for projects set up before
 * the key had its own variable.
 */
export function billingContext(): { stripe: Stripe; customerId: string } | null {
  let secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey && process.env.STRIPE_CONFIG) {
    try {
      secretKey = JSON.parse(process.env.STRIPE_CONFIG).secretKey;
    } catch {
      // Malformed JSON is the same as not configured.
    }
  }
  const customerId = process.env.STRIPE_CUSTOMER_ID;
  if (!secretKey || !customerId) return null;
  return { stripe: new Stripe(secretKey), customerId };
}
