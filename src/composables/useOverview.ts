import { ref } from 'vue';
import { useApi } from '@/composables/useApi';
import { features } from '@/config/dashboard';
import type { AnalyticsReport } from '@/composables/useAnalytics';
import type { LighthouseCheck } from '@/types/report';

export interface SubmissionSummary {
  counts: { kind: string; status: string; n: number }[];
  thisMonth: Record<string, number>;
  recent: { id: string; kind: string; name: string | null; email: string | null; status: string; createdAt: string }[];
}

export interface PendingCharge {
  id: string;
  number: string | null;
  amount: number;
  currency: string;
  dueDate: number | null;
}

/**
 * Everything the overview shows, fetched side by side. Each part loads, fails
 * and renders on its own: a slow Stripe call must not hold up the greeting, and
 * analytics being unavailable must not blank the submissions.
 */
export function useOverview() {
  const api = useApi();

  const submissions = ref<SubmissionSummary | null>(null);
  const month = ref<AnalyticsReport | null>(null);
  const monthState = ref<'loading' | 'ready' | 'none'>('loading');
  const lighthouse = ref<LighthouseCheck | null>(null);
  const healthLoaded = ref(false);
  const charges = ref<PendingCharge[]>([]);

  const json = async (name: string) => {
    const res = await api(name);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data !== 'object') throw new Error(name);
    return data;
  };

  async function load() {
    await Promise.allSettled([
      json('form-submissions?summary=1').then((d) => {
        if (d.configured !== false) submissions.value = d;
      }),
      json('analytics-proxy?period=mtd')
        .then((d) => {
          month.value = d.configured && d.current ? d : null;
          monthState.value = month.value ? 'ready' : 'none';
        })
        .catch(() => (monthState.value = 'none')),
      json('site-health')
        .then((d) => (lighthouse.value = d.lighthouse ?? null))
        .finally(() => (healthLoaded.value = true)),
      features.billing
        ? json('stripe-get-billing-summary').then((d) => (charges.value = d.pendingCharges ?? []))
        : Promise.resolve(),
    ]);
  }

  return { submissions, month, monthState, lighthouse, healthLoaded, charges, load };
}
