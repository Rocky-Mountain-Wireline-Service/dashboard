import { ref } from 'vue';
import { useApi } from '@/composables/useApi';

export type Period = '7d' | '30d' | '13w' | '12m' | 'all';

/**
 * A "visit" throughout is an engaged one: it lasted ten seconds, opened a
 * second page, or got in touch. See the note in the analytics function for why
 * raw visitor counts are not shown.
 */
export interface Totals {
  visits: number;
  /** Every session GA4 recorded, automated ones included. */
  allVisits: number;
  avgSeconds: number;
  contactForms: number;
  applications: number;
  /** Taps on a phone number or email address. */
  contactClicks: number;
  /** Clicks on a "Contact Sales" button. */
  ctaClicks: number;
}

export interface AnalyticsReport {
  configured: true;
  period: Period;
  unit: 'day' | 'week' | 'month';
  current: Totals;
  /** Null for "all time", which has nothing before it. */
  previous: Totals | null;
  /** False until the site has sent its first enquiry event. */
  trackingActive: boolean;
  series: { key: string; visits: number }[];
  pages: { path: string; visits: number }[];
  sources: { source: string; medium: string; visits: number }[];
  /** The same stretch one year earlier; null where that comparison does not apply. */
  lastYear: { visits: number } | null;
  states: { name: string; visits: number }[];
  cities: { name: string; region: string; visits: number }[];
  /** Individual service pages, by name. */
  services: { path: string; name: string; visits: number }[];
  audience: { new: number; returning: number };
  devices: { mobile: number; desktop: number; tablet: number };
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

export interface SearchReport {
  current: { clicks: number; impressions: number; position: number | null };
  previous: { clicks: number; impressions: number; position: number | null } | null;
  queries: { query: string; clicks: number; impressions: number; position: number }[];
}

/**
 * Search terms from Google Search Console. Separate from the main report so a
 * gap in one never blanks the other; `connected` stays false until Search
 * Console access has been set up.
 */
export function useSearchTerms() {
  const api = useApi();
  const search = ref<SearchReport | null>(null);
  const connected = ref(false);

  async function loadSearch(period: Period) {
    try {
      const res = await api(`search-proxy?period=${period}`);
      const data = await res.json().catch(() => null);
      connected.value = Boolean(res.ok && data?.configured && data.current);
      search.value = connected.value ? (data as SearchReport) : null;
    } catch {
      connected.value = false;
      search.value = null;
    }
  }

  return { search, connected, loadSearch };
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
