import { ref } from 'vue';
import { useApi } from '@/composables/useApi';

export type Period = 'today' | '7d' | '30d';

export interface Totals {
  visitors: number;
  pageviews: number;
  sessions: number;
  avgSessionSeconds: number;
  /** Contact and application forms sent. */
  formSubmissions: number;
  /** Taps on a phone number or email address. */
  contactClicks: number;
  /** Clicks on a "Contact Sales" button. */
  ctaClicks: number;
}

export interface AnalyticsReport {
  configured: true;
  period: Period;
  unit: 'hour' | 'day';
  current: Totals;
  previous: Totals;
  series: { key: string; visitors: number }[];
  pages: { path: string; visitors: number; pageviews: number }[];
  sources: { source: string; medium: string; visitors: number }[];
}

/**
 * `setup` — the server has no Google Analytics credentials yet, or they have
 * not been given access to the property. A step for whoever runs the site,
 * not something the person looking at the dashboard did wrong.
 */
export type AnalyticsState = 'loading' | 'ready' | 'setup' | 'error';

export function useAnalytics() {
  const api = useApi();
  const state = ref<AnalyticsState>('loading');
  const report = ref<AnalyticsReport | null>(null);
  const message = ref('');

  async function load(period: Period) {
    state.value = 'loading';
    message.value = '';
    try {
      const res = await api(`analytics-proxy?period=${period}`);
      const data = await res.json().catch(() => null);

      // Anything that is not JSON means the request never reached the function
      // at all. Treating that as a report left the page on its loading skeleton
      // forever, with nothing to say what was wrong.
      if (!data || typeof data !== 'object') {
        throw new Error('The analytics service is not responding.');
      }

      if (data.configured === false) {
        message.value = data.error ?? '';
        state.value = 'setup';
        return;
      }
      if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
      if (!data.current || !Array.isArray(data.series)) {
        throw new Error('Analytics returned something unexpected.');
      }

      report.value = data as AnalyticsReport;
      state.value = 'ready';
    } catch (err) {
      message.value = err instanceof Error ? err.message : 'Analytics could not be loaded.';
      state.value = 'error';
    }
  }

  return { state, report, message, load };
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** Percentage change, or null when there is no earlier figure to compare with. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function trendOf(change: number | null): 'up' | 'down' | 'flat' {
  if (change === null) return 'flat';
  if (change > 5) return 'up';
  if (change < -5) return 'down';
  return 'flat';
}
