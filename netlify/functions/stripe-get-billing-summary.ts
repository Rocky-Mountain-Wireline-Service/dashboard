import type Stripe from 'stripe';
import { json, requireUser } from '../lib/auth';
import { billingContext } from '../lib/stripe';
import { tursoClient } from '../lib/turso';
import config from '../../src/config/dashboard';

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
    /** Set for invoices settled outside Stripe; there is nothing to pay online. */
    offline?: boolean;
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
    /** How an offline payment arrived — "check", "zelle" — when it was not by card. */
    method?: string | null;
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

/** A date column ("2026-09-17") as a timestamp at midday UTC, so no timezone shows it a day out. */
const dayToUnix = (day: unknown): number | null => {
  const ms = typeof day === 'string' ? Date.parse(`${day.slice(0, 10)}T12:00:00Z`) : NaN;
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
};

/**
 * Invoices settled outside Stripe — by check or bank transfer — are recorded in
 * the agency database instead. Without them the page shows a client who has
 * paid in full as having paid nothing.
 *
 * Also returns the maintenance plan when it was prepaid that way: Stripe has no
 * subscription for it, so the page would otherwise say there is no plan at all.
 */
async function offlineBilling(): Promise<{
  paid: BillingSummary['recentPayments'];
  pending: BillingSummary['pendingCharges'];
  prepaidPlan: BillingSummary['subscription'];
}> {
  const empty = { paid: [], pending: [], prepaidPlan: null };
  if (!config.billing?.showOfflineInvoices) return empty;
  const db = tursoClient();
  if (!db) return empty;

  try {
    const [invoices, prepaid] = await Promise.all([
      db.execute({
        sql: `SELECT id, invoice_number, amount, status, product_description,
                     due_date, sent_date, paid_date, payment_method, pdf_url, created_at
                FROM offline_invoices
               WHERE client_id = ? AND status IN ('paid', 'sent')
               ORDER BY COALESCE(paid_date, sent_date, created_at) DESC
               LIMIT 20`,
        args: [config.clientId],
      }),
      db.execute({
        sql: `SELECT amount, metadata, created_at FROM billing_events
               WHERE client_id = ? AND event_type = 'maintenance_prepaid'
               ORDER BY created_at DESC LIMIT 1`,
        args: [config.clientId],
      }),
    ]);

    const paid: BillingSummary['recentPayments'] = [];
    const pending: BillingSummary['pendingCharges'] = [];
    for (const row of invoices.rows) {
      const base = {
        id: `offline-${row.id}`,
        number: (row.invoice_number as string) ?? null,
        amount: Number(row.amount) || 0,
        currency: 'usd',
        description: (row.product_description as string) ?? null,
        created: dayToUnix(row.sent_date) ?? dayToUnix(row.created_at) ?? 0,
        hostedInvoiceUrl: null,
      };
      if (row.status === 'paid') {
        paid.push({
          ...base,
          paidAt: dayToUnix(row.paid_date),
          invoicePdf: (row.pdf_url as string) ?? null,
          method: (row.payment_method as string) ?? null,
        });
      } else {
        pending.push({ ...base, dueDate: dayToUnix(row.due_date), offline: true });
      }
    }

    let prepaidPlan: BillingSummary['subscription'] = null;
    const event = prepaid.rows[0];
    if (event) {
      let meta: { nextBillingDate?: string; maintenanceCycle?: string } = {};
      try {
        meta = JSON.parse(String(event.metadata ?? '{}'));
      } catch {
        // The plan still shows, without a renewal date.
      }
      const next = dayToUnix(meta.nextBillingDate);
      // Once the prepaid term has run out this is history, not the current plan.
      if (!next || next * 1000 > Date.now()) {
        prepaidPlan = {
          id: 'prepaid-maintenance',
          status: 'prepaid',
          planName: 'Website maintenance',
          amount: Number(event.amount) || 0,
          currency: 'usd',
          interval: meta.maintenanceCycle === 'monthly' ? 'month' : 'year',
          nextBillingDate: next,
          cancelAtPeriodEnd: false,
        };
      }
    }

    return { paid, pending, prepaidPlan };
  } catch (err) {
    // Stripe's half of the page is still worth showing.
    console.error('Offline billing lookup failed:', err instanceof Error ? err.message : err);
    return empty;
  }
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
    const offlinePromise = offlineBilling();
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

    // The newest subscription is not necessarily the current one: a canceled
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

    const offline = await offlinePromise;
    const newestPayment = (p: BillingSummary['recentPayments'][number]) => p.paidAt ?? p.created;

    const summary: BillingSummary = {
      // A plan still running in Stripe wins; a prepaid one fills the gap when
      // Stripe has nothing live.
      subscription:
        subscription && LIVE.includes(subscription.status)
          ? subscription
          : offline.prepaidPlan ?? subscription,
      pendingCharges: [...offline.pending, ...openInvoices.data.map((inv) => ({
        id: inv.id ?? '',
        number: inv.number,
        amount: inv.amount_remaining ?? inv.amount_due,
        currency: inv.currency,
        description: inv.description,
        created: inv.created,
        dueDate: inv.due_date,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      }))],
      recentPayments: [...offline.paid, ...paidInvoices.data.map((inv) => ({
        id: inv.id ?? '',
        number: inv.number,
        amount: inv.amount_paid,
        currency: inv.currency,
        description: inv.description,
        created: inv.created,
        paidAt: inv.status_transitions?.paid_at ?? null,
        hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
        invoicePdf: inv.invoice_pdf ?? null,
      }))]
        .sort((x, y) => newestPayment(y) - newestPayment(x))
        .slice(0, 12),
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
