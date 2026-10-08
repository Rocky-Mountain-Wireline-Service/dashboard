<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import {
  Users, Eye, Clock, FileText, Phone, MousePointerClick,
  TrendingUp, TrendingDown, Minus, RefreshCw, Settings,
} from 'lucide-vue-next';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import config from '@/config/dashboard';
import {
  useAnalytics, formatDuration, pctChange, trendOf,
  type Period,
} from '@/composables/useAnalytics';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

const conversionPage = config.analytics?.conversionPage ?? '/contact';

const { state, report, message, load } = useAnalytics();
const period = ref<Period>('30d');
const chartCanvas = ref<HTMLCanvasElement | null>(null);
let chartInstance: Chart | null = null;

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};
const PERIOD_WORDS: Record<Period, string> = {
  today: 'today',
  '7d': 'in the last 7 days',
  '30d': 'in the last 30 days',
};
const PREV_PERIOD_WORDS: Record<Period, string> = {
  today: 'yesterday',
  '7d': 'the 7 days before',
  '30d': 'the 30 days before',
};

async function fetchAnalytics() {
  await load(period.value);
  await nextTick();
  renderChart();
}

function changePeriod(p: Period) {
  period.value = p;
  fetchAnalytics();
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// ─── Story ──────────────────────────────────────────────────────────────────

const visitorChange = computed(() =>
  report.value ? pctChange(report.value.current.visitors, report.value.previous.visitors) : null
);

const storyHeadline = computed(() => {
  if (!report.value) return '';
  const v = report.value.current.visitors;
  const change = visitorChange.value;
  const prev = PREV_PERIOD_WORDS[period.value];

  let trend = '';
  if (change === null) trend = '';
  else if (change > 50) trend = ` — well up on ${prev}`;
  else if (change > 10) trend = ` — up from ${prev}`;
  else if (change >= -10) trend = ` — about the same as ${prev}`;
  else trend = ` — down from ${prev}`;

  return `${plural(v, 'person', 'people')} visited your site ${PERIOD_WORDS[period.value]}${trend}.`;
});

const storySubline = computed(() => {
  if (!report.value) return '';
  const { formSubmissions, contactClicks } = report.value.current;
  if (!formSubmissions && !contactClicks) {
    return 'No one sent a form or tapped a phone number or email address in that time.';
  }
  return `They sent ${plural(formSubmissions, 'form', 'forms')} and tapped a phone number or email address ${plural(contactClicks, 'time', 'times')}.`;
});

// ─── Metric cards ───────────────────────────────────────────────────────────

function trendLabel(change: number | null): string {
  if (change === null) return 'No earlier figure to compare';
  const dir = trendOf(change);
  if (dir === 'flat') return 'About the same';
  return `${dir === 'up' ? 'Up' : 'Down'} ${Math.abs(change)}%`;
}

const trafficCards = computed(() => {
  if (!report.value) return [];
  const { current: c, previous: p } = report.value;
  return [
    { label: 'Visitors', value: c.visitors.toLocaleString(), change: pctChange(c.visitors, p.visitors), icon: Users },
    { label: 'Page views', value: c.pageviews.toLocaleString(), change: pctChange(c.pageviews, p.pageviews), icon: Eye },
    { label: 'Avg. visit length', value: formatDuration(c.avgSessionSeconds), change: pctChange(c.avgSessionSeconds, p.avgSessionSeconds), icon: Clock },
  ];
});

const enquiryCards = computed(() => {
  if (!report.value) return [];
  const { current: c, previous: p } = report.value;
  return [
    { label: 'Forms sent', value: c.formSubmissions.toLocaleString(), change: pctChange(c.formSubmissions, p.formSubmissions), icon: FileText },
    { label: 'Phone & email taps', value: c.contactClicks.toLocaleString(), change: pctChange(c.contactClicks, p.contactClicks), icon: Phone },
    { label: 'Contact Sales clicks', value: c.ctaClicks.toLocaleString(), change: pctChange(c.ctaClicks, p.ctaClicks), icon: MousePointerClick },
  ];
});

// ─── Visitor journey ────────────────────────────────────────────────────────

const funnel = computed(() => {
  if (!report.value) return [];
  const { current: c, pages } = report.value;
  const total = c.visitors;
  const reached = pages.find((p) => p.path.replace(/\/$/, '') === conversionPage)?.visitors ?? 0;
  const pct = (n: number) => (total ? Math.min(100, Math.round((n / total) * 100)) : 0);

  return [
    { label: 'Visited your site', count: total, pct: total ? 100 : 0, color: 'var(--color-primary)' },
    { label: 'Opened the contact page', count: reached, pct: pct(reached), color: 'var(--color-secondary)' },
    { label: 'Sent a form', count: c.formSubmissions, pct: pct(c.formSubmissions), color: 'var(--color-accent)' },
  ];
});

// ─── Top pages ──────────────────────────────────────────────────────────────

const topPages = computed(() => report.value?.pages.slice(0, 10) ?? []);
const maxPageVisitors = computed(() => Math.max(1, ...topPages.value.map((p) => p.visitors)));

// ─── Insight ────────────────────────────────────────────────────────────────

const insightText = computed(() => {
  if (!report.value) return '';
  const { visitors, formSubmissions, contactClicks } = report.value.current;
  const change = visitorChange.value;

  if (!visitors) {
    return 'No visits have been recorded for this period yet. If the site has only just launched, figures usually start to appear within a day.';
  }
  if (visitors >= 50 && !formSubmissions && !contactClicks) {
    return `${visitors.toLocaleString()} people visited without getting in touch. It is worth checking that the phone number and the Contact Sales button are easy to find on the pages they land on.`;
  }
  if (change !== null && change < -10) {
    return 'Traffic dipped this period. That often follows a quiet spell in outreach — sharing a recent job or update on social media tends to bring people back.';
  }
  if (change !== null && change > 50) {
    return 'Traffic is growing. A good moment to make sure new visitors can see how to reach you from the first page they open.';
  }
  return 'Steady traffic compounds over time. Keeping service and equipment pages current helps the site stay visible in search results.';
});

// ─── Where visits came from ─────────────────────────────────────────────────

const SEARCH_ENGINES = ['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave'];
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const sourceRows = computed(() => {
  // Several GA4 rows can describe the same thing in plain terms (google/organic
  // and google/cpc are both "Google"), so they are merged by display name.
  const merged = new Map<string, { name: string; desc: string; visitors: number }>();

  for (const row of report.value?.sources ?? []) {
    const source = row.source.toLowerCase();
    const medium = row.medium.toLowerCase();
    let name: string;
    let desc = '';

    if (source === '(direct)' || !source || source === '(not set)') {
      name = 'Direct';
      desc = 'Typed the address, used a bookmark, or followed a link in an email';
    } else if (medium === 'organic' && SEARCH_ENGINES.some((e) => source.includes(e))) {
      name = `${titleCase(SEARCH_ENGINES.find((e) => source.includes(e))!)} Search`;
      desc = 'Searched and found you';
    } else if (source.includes('google') && ['cpc', 'ppc', 'paid'].includes(medium)) {
      name = 'Google Ads';
      desc = 'Clicked a paid advert';
    } else if (source.includes('facebook') || source.includes('fb.')) {
      name = 'Facebook';
      desc = 'A post or profile link';
    } else if (source.includes('linkedin') || source === 'lnkd.in') {
      name = 'LinkedIn';
      desc = 'A post or profile link';
    } else {
      name = row.source.replace(/^https?:\/\//, '').replace(/\/$/, '');
      desc = medium === 'referral' ? 'A link on another website' : '';
    }

    const existing = merged.get(name);
    if (existing) existing.visitors += row.visitors;
    else merged.set(name, { name, desc, visitors: row.visitors });
  }

  return [...merged.values()].sort((a, b) => b.visitors - a.visitors);
});

// ─── Chart ──────────────────────────────────────────────────────────────────

const chartLabel = computed(() => (report.value?.unit === 'hour' ? 'Visitors by hour' : 'Visitors by day'));

function pointLabel(key: string, unit: 'hour' | 'day'): string {
  if (unit === 'hour') {
    const h = Number(key);
    return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  }
  // Parsed as local noon so the label cannot slip a day across a timezone.
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The chart is a picture; this is the same information for a screen reader. */
const chartSummary = computed(() => {
  const series = report.value?.series ?? [];
  if (!series.length || !report.value) return '';
  const peak = series.reduce((a, b) => (b.visitors > a.visitors ? b : a));
  if (!peak.visitors) return `${chartLabel.value}: no visitors recorded.`;
  return `${chartLabel.value}. Busiest: ${pointLabel(peak.key, report.value.unit)} with ${plural(peak.visitors, 'visitor', 'visitors')}.`;
});

function renderChart() {
  chartInstance?.destroy();
  chartInstance = null;
  if (!chartCanvas.value || !report.value) return;

  const css = getComputedStyle(document.documentElement);
  const primary = css.getPropertyValue('--color-primary').trim() || '#710a0c';
  const muted = css.getPropertyValue('--color-text-secondary').trim() || '#4b5563';
  const { series, unit } = report.value;

  chartInstance = new Chart(chartCanvas.value, {
    type: 'bar',
    data: {
      labels: series.map((p) => pointLabel(p.key, unit)),
      datasets: [{ data: series.map((p) => p.visitors), backgroundColor: primary, borderRadius: 3, barPercentage: 0.7 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: { callbacks: { label: (ctx) => plural(Number(ctx.parsed.y), 'visitor', 'visitors') } },
        legend: { display: false },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: muted, maxRotation: 0, autoSkipPadding: 12 } },
        y: { beginAtZero: true, ticks: { precision: 0, maxTicksLimit: 4, font: { size: 11 }, color: muted }, border: { display: false } },
      },
    },
  });
}

onMounted(fetchAnalytics);
onBeforeUnmount(() => chartInstance?.destroy());
</script>

<template>
  <DashboardLayout page-title="Site Analytics">
    <!-- Not connected yet: a setup step, not an error the reader caused. -->
    <div v-if="state === 'setup'" class="ana-ga4">
      <Settings :size="48" style="opacity: 0.3" aria-hidden="true" />
      <h2 class="ana-ga4__title">Analytics is being connected</h2>
      <p class="ana-ga4__desc">
        {{ message || 'Your site is already collecting visitor data. It will appear here once the connection to Google Analytics is finished.' }}
      </p>
    </div>

    <div v-else class="ana">
      <div class="ana__periods" role="group" aria-label="Time period">
        <button
          v-for="(label, key) in PERIOD_LABELS"
          :key="key"
          type="button"
          class="ana__period"
          :class="{ 'ana__period--active': period === key }"
          :aria-pressed="period === key"
          @click="changePeriod(key)"
        >
          {{ label }}
        </button>
      </div>

      <template v-if="state === 'loading'">
        <p class="ana__sr-only" role="status">Loading analytics…</p>
        <div class="ana__skeleton ana__skeleton--story"></div>
        <div class="ana__skeleton ana__skeleton--chart"></div>
        <div class="ana__skeleton-grid">
          <div class="ana__skeleton ana__skeleton--card"></div>
          <div class="ana__skeleton ana__skeleton--card"></div>
          <div class="ana__skeleton ana__skeleton--card"></div>
        </div>
      </template>

      <div v-else-if="state === 'error'" class="ana__error" role="alert">
        <p class="ana__error-msg">{{ message || "Couldn't load analytics data" }}</p>
        <button type="button" class="ana__error-btn" @click="fetchAnalytics">
          <RefreshCw :size="14" aria-hidden="true" /> Try again
        </button>
      </div>

      <template v-else-if="report">
        <div class="ana__story">
          <p class="ana__story-headline">{{ storyHeadline }}</p>
          <p class="ana__story-sub">{{ storySubline }}</p>
        </div>

        <div class="ana__chart-section">
          <p class="ana__section-label">{{ chartLabel }}</p>
          <div class="ana__chart-wrap">
            <canvas ref="chartCanvas" role="img" :aria-label="chartSummary"></canvas>
          </div>
        </div>

        <p class="ana__section-label">Traffic</p>
        <div class="ana__metrics">
          <div v-for="card in trafficCards" :key="card.label" class="ana__metric">
            <div class="ana__metric-header">
              <component :is="card.icon" :size="16" class="ana__metric-icon" aria-hidden="true" />
              <span class="ana__metric-label">{{ card.label }}</span>
            </div>
            <p class="ana__metric-value">{{ card.value }}</p>
            <div
              class="ana__metric-trend"
              :class="{
                'ana__metric-trend--up': trendOf(card.change) === 'up',
                'ana__metric-trend--down': trendOf(card.change) === 'down',
              }"
            >
              <TrendingUp v-if="trendOf(card.change) === 'up'" :size="14" aria-hidden="true" />
              <TrendingDown v-else-if="trendOf(card.change) === 'down'" :size="14" aria-hidden="true" />
              <Minus v-else :size="14" aria-hidden="true" />
              <span>{{ trendLabel(card.change) }}</span>
            </div>
          </div>
        </div>

        <p class="ana__section-label">People getting in touch</p>
        <div class="ana__metrics">
          <div v-for="card in enquiryCards" :key="card.label" class="ana__metric">
            <div class="ana__metric-header">
              <component :is="card.icon" :size="16" class="ana__metric-icon" aria-hidden="true" />
              <span class="ana__metric-label">{{ card.label }}</span>
            </div>
            <p class="ana__metric-value">{{ card.value }}</p>
            <div
              class="ana__metric-trend"
              :class="{
                'ana__metric-trend--up': trendOf(card.change) === 'up',
                'ana__metric-trend--down': trendOf(card.change) === 'down',
              }"
            >
              <TrendingUp v-if="trendOf(card.change) === 'up'" :size="14" aria-hidden="true" />
              <TrendingDown v-else-if="trendOf(card.change) === 'down'" :size="14" aria-hidden="true" />
              <Minus v-else :size="14" aria-hidden="true" />
              <span>{{ trendLabel(card.change) }}</span>
            </div>
          </div>
        </div>

        <div class="ana__funnel">
          <p class="ana__section-label">Visitor journey</p>
          <div v-for="step in funnel" :key="step.label" class="ana__funnel-row">
            <span class="ana__funnel-label">{{ step.label }}</span>
            <div class="ana__funnel-track" aria-hidden="true">
              <div
                class="ana__funnel-fill"
                :style="{ width: step.count ? `clamp(6px, ${step.pct}%, 100%)` : '0', backgroundColor: step.color }"
              ></div>
            </div>
            <span class="ana__funnel-pct">{{ step.count.toLocaleString() }}</span>
          </div>
        </div>

        <div class="ana__pages">
          <div class="ana__pages-header">
            <p class="ana__section-label">Most visited pages</p>
          </div>
          <p v-if="!topPages.length" class="ana__referrers-empty">No page visits recorded for this period.</p>
          <div class="ana__pages-list">
            <div v-for="page in topPages" :key="page.path" class="ana__page-row">
              <span class="ana__page-path">{{ page.path }}</span>
              <div class="ana__page-bar-track" aria-hidden="true">
                <div
                  class="ana__page-bar-fill"
                  :style="{ width: `${Math.max(2, (page.visitors / maxPageVisitors) * 100)}%` }"
                ></div>
              </div>
              <span class="ana__page-count">{{ page.visitors.toLocaleString() }}</span>
            </div>
          </div>
        </div>

        <div class="ana__insight">
          <div class="ana__insight-dot" aria-hidden="true"></div>
          <div>
            <p class="ana__insight-heading">Worth knowing</p>
            <p class="ana__insight-text">{{ insightText }}</p>
          </div>
        </div>

        <div class="ana__referrers">
          <p class="ana__section-label">How people found you</p>
          <div v-if="sourceRows.length === 0" class="ana__referrers-empty">No visits recorded for this period.</div>
          <div v-for="row in sourceRows" :key="row.name" class="ana__referrer-row">
            <div class="ana__referrer-info">
              <span class="ana__referrer-name">{{ row.name }}</span>
              <span v-if="row.desc" class="ana__referrer-desc">{{ row.desc }}</span>
            </div>
            <span class="ana__referrer-count">{{ row.visitors.toLocaleString() }}</span>
          </div>
        </div>
      </template>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.ana { max-width: 720px; }

/* ─── Period selector ─────────────────────────────────────────────────────── */
.ana__periods {
  display: flex; gap: 0.25rem; background-color: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--border-radius);
  padding: 0.25rem; width: fit-content; margin-bottom: 1.5rem;
}
.ana__period {
  padding: 0.375rem 0.75rem; font-size: 0.8125rem; font-weight: 500;
  border: none; border-radius: calc(var(--border-radius) - 2px); background: none;
  color: var(--color-text-secondary, var(--color-text)); cursor: pointer; transition: all 0.15s ease;
}
.ana__period--active { background-color: var(--color-primary); color: var(--color-on-primary); }

/* ─── Loading skeletons ───────────────────────────────────────────────────── */
.ana__skeleton { background-color: var(--color-surface); border-radius: var(--border-radius); animation: pulse 1.5s ease-in-out infinite; }
.ana__skeleton--story { height: 80px; margin-bottom: 1rem; }
.ana__skeleton--chart { height: 90px; margin-bottom: 1rem; }
.ana__skeleton--card { height: 100px; }
.ana__skeleton-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

/* ─── Error ───────────────────────────────────────────────────────────────── */
.ana__error {
  text-align: center; padding: 3rem; background-color: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--border-radius);
}
.ana__error-msg { font-size: 0.9375rem; color: var(--color-text); margin-bottom: 1rem; }
.ana__error-btn {
  display: inline-flex; align-items: center; gap: 0.375rem;
  padding: 0.5rem 1rem; background-color: var(--color-primary); color: var(--color-on-primary);
  border: none; border-radius: var(--border-radius); font-size: 0.8125rem; font-weight: 600; cursor: pointer;
}

/* ─── Story card ──────────────────────────────────────────────────────────── */
.ana__story {
  border-left: 3px solid var(--color-primary); background-color: var(--color-surface);
  padding: 1.25rem 1.5rem; border-radius: var(--border-radius); margin-bottom: 1.5rem;
}
.ana__story-headline { font-size: 1.125rem; font-weight: 500; color: var(--color-text); line-height: 1.5; }
.ana__story-sub { font-size: 0.8125rem; color: var(--color-text-secondary, var(--color-text)); margin-top: 0.375rem; }

/* ─── Chart ───────────────────────────────────────────────────────────────── */
.ana__chart-section { margin-bottom: 1.5rem; }
.ana__chart-wrap { height: 160px; }

/* ─── Metrics ─────────────────────────────────────────────────────────────── */
.ana__metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; }
.ana__metric {
  background-color: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--border-radius); padding: 1rem;
}
.ana__metric-header { display: flex; align-items: center; gap: 0.375rem; margin-bottom: 0.375rem; }
.ana__metric-icon { color: var(--color-text-secondary, var(--color-text)); }
.ana__metric-label { font-size: 0.6875rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-secondary, var(--color-text)); }
.ana__metric-value { font-size: 1.5rem; font-weight: 700; color: var(--color-text); font-family: var(--font-heading); }
.ana__metric-trend { display: flex; align-items: center; gap: 0.25rem; margin-top: 0.25rem; font-size: 0.75rem; color: var(--color-text-secondary, var(--color-text)); }
.ana__metric-trend--up { color: var(--color-up); }
.ana__metric-trend--down { color: var(--color-down); }

/* ─── Funnel ──────────────────────────────────────────────────────────────── */
.ana__funnel { margin-bottom: 1.5rem; }
.ana__funnel-row { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
.ana__funnel-label { font-size: 0.8125rem; color: var(--color-text); min-width: 172px; flex-shrink: 0; }
.ana__funnel-track { flex: 1; height: 20px; background-color: var(--color-surface); border-radius: 4px; overflow: hidden; border: 1px solid var(--color-border); }
.ana__funnel-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
.ana__funnel-pct { font-size: 0.8125rem; font-weight: 600; color: var(--color-text); min-width: 36px; text-align: right; }

/* ─── Top pages ───────────────────────────────────────────────────────────── */
.ana__pages { margin-bottom: 1.5rem; }
.ana__pages-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
.ana__toggle { font-size: 0.75rem; font-weight: 500; color: var(--color-primary); background: none; border: none; cursor: pointer; }
.ana__toggle:hover { text-decoration: underline; }
.ana__pages-list { display: flex; flex-direction: column; gap: 0.375rem; }
.ana__page-row { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.75rem; background-color: var(--color-surface); border-radius: var(--border-radius); }
.ana__page-row--internal { opacity: 0.4; }
.ana__page-path { font-family: monospace; font-size: 0.8125rem; color: var(--color-text); min-width: 140px; flex-shrink: 0; }
.ana__page-badge { font-family: var(--font-body); font-size: 0.6875rem; color: var(--color-text-secondary, var(--color-text)); margin-left: 0.25rem; }
.ana__page-bar-track { flex: 1; height: 8px; background-color: var(--color-border); border-radius: 4px; overflow: hidden; }
.ana__page-bar-fill { height: 100%; background-color: var(--color-primary); border-radius: 4px; transition: width 0.3s ease; }
.ana__page-count { font-size: 0.8125rem; font-weight: 600; color: var(--color-text); min-width: 32px; text-align: right; }

/* ─── Insight ─────────────────────────────────────────────────────────────── */
.ana__insight {
  display: flex; gap: 0.75rem; padding: 1.25rem;
  background-color: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--border-radius); margin-bottom: 1.5rem;
}
.ana__insight-dot { width: 8px; height: 8px; border-radius: 50%; background-color: #f59e0b; margin-top: 0.375rem; flex-shrink: 0; }
.ana__insight-heading { font-size: 0.8125rem; font-weight: 600; color: var(--color-text); margin-bottom: 0.25rem; }
.ana__insight-text { font-size: 0.8125rem; color: var(--color-text-secondary, var(--color-text)); line-height: 1.6; }

/* ─── Referrers ───────────────────────────────────────────────────────────── */
.ana__referrers { margin-bottom: 1.5rem; }
.ana__referrers-empty { font-size: 0.8125rem; color: var(--color-text-secondary, var(--color-text)); padding: 1rem 0; }
.ana__referrer-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 0; border-bottom: 1px solid var(--color-border);
}
.ana__referrer-info { display: flex; flex-direction: column; gap: 0.125rem; }
.ana__referrer-name { font-size: 0.875rem; font-weight: 500; color: var(--color-text); }
.ana__referrer-desc { font-size: 0.75rem; color: var(--color-text-secondary, var(--color-text)); }
.ana__referrer-count { font-size: 0.875rem; font-weight: 600; color: var(--color-text); }

/* ─── Section label ───────────────────────────────────────────────────────── */
.ana__section-label {
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--color-text-secondary, var(--color-text)); margin-bottom: 0.75rem;
}

/* ─── GA4 fallback ────────────────────────────────────────────────────────── */
.ana-ga4 {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.75rem; padding: 4rem 2rem; text-align: center; color: var(--color-text-secondary);
}
.ana-ga4__title { font-family: var(--font-heading); font-size: 1.25rem; font-weight: 700; color: var(--color-text); margin: 0; }
.ana-ga4__desc { max-width: 400px; line-height: 1.5; font-size: 0.9375rem; }
.ana-ga4__btn {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.625rem 1.25rem; background-color: var(--color-primary); color: var(--color-on-primary);
  border-radius: var(--border-radius); font-size: 0.875rem; font-weight: 600; text-decoration: none;
}

/* ─── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .ana__metrics { grid-template-columns: 1fr; }
  .ana__funnel-label { min-width: 128px; font-size: 0.75rem; }
  .ana__page-path { min-width: 100px; }
}

.ana__sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
</style>
