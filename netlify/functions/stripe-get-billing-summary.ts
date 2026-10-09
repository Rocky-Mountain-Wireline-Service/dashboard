import type Stripe from 'stripe';
import { json, requireUser } from '../lib/auth';
import { billingContext } from '../lib/stripe';

interface BillingSummary {
  subscription: {
    id: string;
    status: string;
    planName: string;
    amount: number;
    currency: string;
    interval: string;
    nextBillingDate: number | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  pendingCharges: Array<{
    id: string;
    number: string | null;
    amount: number;
    currency: string;
    description: string | null;
    created: number;
    dueDate: number | null;
    hostedInvoiceUrl: string | null;
  }>;
  recentPayments: Array<{
    id: string;
    number: string | null;
    amount: number;
    currency: string;
    description: string | null;
    created: number;
    paidAt: number | null;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
  }>;
  paymentMethod: {
    /** "card" or "bank" */
    type: 'card' | 'bank';
    brand: string;
    last4: string;
    expMonth: number | null;
    expYear: number | null;
  } | null;
}

/** A subscription that is still running outranks one that has ended. */
const LIVE = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'];

function describePaymentMethod(pm: unknown): BillingSummary['paymentMethod'] {
  if (!pm || typeof pm !== 'object') return null;
  const method = pm as Stripe.PaymentMethod;
  if (method.card) {
    return {
      type: 'card',
      brand: method.card.brand || 'card',
      last4: method.card.last4 || '',
      expMonth: method.card.exp_month ?? null,
      expYear: method.card.exp_year ?? null,
    };
  }
  if (method.us_bank_account) {
    return {
      type: 'bank',
      brand: method.us_bank_account.bank_name || 'Bank account',
      last4: method.us_bank_account.last4 || '',
      expMonth: null,
      expYear: null,
    };
  }
  return null;
}

export async function handler(event: { headers: Record<string, string> }) {
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  const ctx = billingContext();
  if (!ctx) return json(200, { configured: false });
  const { stripe, customerId, customerIds } = ctx;

  try {
    // One round of requests per customer record, gathered into single lists.
    const perCustomer = await Promise.all(
      customerIds.map((id) =>
        Promise.all([
          stripe.customers.retrieve(id, { expand: ['invoice_settings.default_payment_method'] }),
          stripe.subscriptions.list({
            customer: id,
            status: 'all',
            limit: 10,
            expand: ['data.default_payment_method'],
          }),
          stripe.invoices.list({ customer: id, status: 'open', limit: 10 }),
          stripe.invoices.list({ customer: id, status: 'paid', limit: 10 }),
        ])
      )
    );

    const customers = perCustomer.flatMap(([c]) => (c.deleted ? [] : [c as Stripe.Customer]));
    if (!customers.some((c) => c.id === customerId)) {
      console.error(`Stripe customer ${customerId} has been deleted.`);
      return json(200, { configured: false });
    }

    const newestFirst = <T extends { created: number }>(rows: T[]) =>
      rows.sort((a, b) => b.created - a.created);
    const subscriptions = { data: newestFirst(perCustomer.flatMap(([, s]) => s.data)) };
    const openInvoices = { data: newestFirst(perCustomer.flatMap(([, , o]) => o.data)) };
    const paidInvoices = { data: newestFirst(perCustomer.flatMap(([, , , p]) => p.data)).slice(0, 10) };

    // The newest subscription is not necessarily the current one: a cancelled
    // plan that was later replaced would otherwise hide the plan now running.
    const sub =
      subscriptions.data.find((s) => LIVE.includes(s.status)) ?? subscriptions.data[0] ?? null;

    let subscription: BillingSummary['subscription'] = null;
    if (sub) {
      const item = sub.items.data[0];
      let planName = 'Subscription';
      const product = item?.price?.product;
      if (product) {
        try {
          planName = (await stripe.products.retrieve(typeof product === 'string' ? product : product.id)).name;
        } catch {
          // The plan still shows, under a generic name.
        }
      }

      subscription = {
        id: sub.id,
        status: sub.status,
        planName,
        amount: (item?.price?.unit_amount ?? 0) * (item?.quantity ?? 1),
        currency: item?.price?.currency || 'usd',
        interval: item?.price?.recurring?.interval || 'month',
        // Stripe moved the period from the subscription to its items; older
        // API versions still send it on the subscription itself.
        nextBillingDate:
          item?.current_period_end ??
          (sub as unknown as { current_period_end?: number }).current_period_end ??
          null,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
    }

    const summary: BillingSummary = {
      subscription,
      pendingCharges: openInvoices.data.map((inv) => ({
        id: inv.id ?? '',
        number: inv.number,
        amount: inv.amount_remaining ?? inv.amount_due,
        currency: inv.currency,
        description: inv.description,
        created: inv.created,
        dueDate: inv.due_date,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      })),
      recentPayments: paidInvoices.data.map((inv) => ({
        id: inv.id ?? '',
        number: inv.number,
        amount: inv.amount_paid,
        currency: inv.currency,
        description: inv.description,
        created: inv.created,
        paidAt: inv.status_transitions?.paid_at ?? null,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
        invoicePdf: inv.invoice_pdf ?? null,
      })),
      // The customer's default, or failing that the one the subscription charges.
      paymentMethod:
        customers
          .map((c) => describePaymentMethod(c.invoice_settings?.default_payment_method))
          .find(Boolean) ?? describePaymentMethod(sub?.default_payment_method),
    };

    return json(200, { configured: true, success: true, ...summary });
  } catch (err) {
    // Stripe's messages name keys and object IDs; they stay in the log.
    console.error('Billing summary error:', err instanceof Error ? err.message : err);
    return json(502, { configured: true, error: 'Billing information could not be loaded. Please try again shortly.' });
  }
}
