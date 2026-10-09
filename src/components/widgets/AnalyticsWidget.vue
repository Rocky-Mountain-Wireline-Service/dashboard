<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { BarChart3, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-vue-next';
import { useAnalytics, pctChange, trendOf } from '@/composables/useAnalytics';

const { state, report, load } = useAnalytics();

const trend = computed(() =>
  report.value?.previous
    ? trendOf(pctChange(report.value.current.visits, report.value.previous.visits))
    : 'flat'
);

onMounted(() => load('30d'));
</script>

<template>
  <div class="widget">
    <h2 class="widget__title"><BarChart3 :size="18" aria-hidden="true" /> Site Analytics</h2>

    <div v-if="state === 'loading'" class="widget__loading" role="status">
      <Loader2 :size="18" class="widget__spinner" aria-hidden="true" />
      <span>Loading...</span>
    </div>

    <div v-else-if="state === 'ready' && report" class="widget__content">
      <p class="widget__provider">Last 30 days</p>
      <div class="widget__stats">
        <div class="widget__pill">
          <span class="widget__pill-value">{{ report.current.visits.toLocaleString() }}</span>
          <span class="widget__pill-label">real visits</span>
          <span
            class="widget__pill-trend"
            :class="{
              'widget__pill-trend--up': trend === 'up',
              'widget__pill-trend--down': trend === 'down',
            }"
          >
            <TrendingUp v-if="trend === 'up'" :size="12" aria-label="up on the previous 30 days" />
            <TrendingDown v-else-if="trend === 'down'" :size="12" aria-label="down on the previous 30 days" />
            <Minus v-else :size="12" aria-hidden="true" />
          </span>
        </div>
        <template v-if="report.trackingActive">
          <div class="widget__pill">
            <span class="widget__pill-value">{{ report.current.contactForms.toLocaleString() }}</span>
            <span class="widget__pill-label">contact forms</span>
          </div>
          <div class="widget__pill">
            <span class="widget__pill-value">{{ report.current.applications.toLocaleString() }}</span>
            <span class="widget__pill-label">job applications</span>
          </div>
        </template>
      </div>
      <RouterLink to="/analytics" class="widget__link">View full analytics &rarr;</RouterLink>
    </div>

    <div v-else-if="state === 'setup'" class="widget__placeholder">
      <p>Analytics is being connected. Your site is already collecting visitor data.</p>
    </div>

    <div v-else class="widget__content">
      <p class="widget__provider">Analytics could not be loaded just now.</p>
      <RouterLink to="/analytics" class="widget__link">Open analytics &rarr;</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.widget {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 1.25rem;
}

.widget__title {
  font-size: 1rem;
  font-family: var(--font-heading);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  color: var(--color-text);
}

.widget__content {
  padding: 0.5rem 0;
}

.widget__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.widget__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.625rem;
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.8125rem;
}

.widget__pill-value {
  font-weight: 600;
  color: var(--color-text);
}

.widget__pill-label {
  color: var(--color-text-secondary, var(--color-text));
}

.widget__pill-trend {
  display: inline-flex;
  align-items: center;
  color: var(--color-text-secondary, var(--color-text));
}

.widget__pill-trend--up { color: var(--color-up); }
.widget__pill-trend--down { color: var(--color-down); }

.widget__provider {
  font-size: 0.875rem;
  color: var(--color-text-secondary, var(--color-text));
  margin-bottom: 0.75rem;
}

.widget__link {
  display: inline-block;
  color: var(--color-primary);
  font-size: 0.875rem;
  text-decoration: none;
}

.widget__link:hover {
  text-decoration: underline;
}

.widget__placeholder {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary, var(--color-text));
  font-size: 0.875rem;
  border: 1px dashed var(--color-border);
  border-radius: var(--border-radius);
}

.widget__loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem;
  justify-content: center;
  color: var(--color-text-secondary, var(--color-text));
  font-size: 0.875rem;
}

.widget__spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
