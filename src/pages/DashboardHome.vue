<script setup lang="ts">
import { computed, onMounted } from 'vue';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import OverviewGreeting from '@/components/overview/OverviewGreeting.vue';
import AttentionStrip from '@/components/overview/AttentionStrip.vue';
import MonthToDate from '@/components/overview/MonthToDate.vue';
import RecentSubmissions from '@/components/overview/RecentSubmissions.vue';
import SiteHealth from '@/components/overview/SiteHealth.vue';
import MonthlyReportWidget from '@/components/widgets/MonthlyReportWidget.vue';
import TutorialsWidget from '@/components/widgets/TutorialsWidget.vue';
import ContentEditorWidget from '@/components/widgets/ContentEditorWidget.vue';
import { useOverview } from '@/composables/useOverview';
import config from '@/config/dashboard';

/**
 * The page the client lands on, read top to bottom:
 *
 *   1. who it's for, and the things they came to do (greeting, quick actions)
 *   2. anything waiting on them (new submissions, an unpaid invoice)
 *   3. how this month is going, live
 *   4. how last month went, settled (the monthly report)
 *   …with the latest submissions and the site's health alongside.
 *
 * Links and the analytics summary used to sit here as separate widgets; their
 * content now lives in the greeting's actions and the month-so-far card.
 */
const { submissions, month, monthState, lighthouse, healthLoaded, charges, load } = useOverview();
const submissionsLoaded = computed(() => submissions.value !== null || monthState.value !== 'loading');

/** Optional extras some clients have; RMWS has none enabled today. */
const extras = computed(() =>
  [
    config.enabledWidgets.includes('tutorials') ? TutorialsWidget : null,
    config.enabledWidgets.includes('contentEditors') ? ContentEditorWidget : null,
  ].filter(Boolean)
);

onMounted(load);
</script>

<template>
  <DashboardLayout page-title="Overview">
    <div class="overview">
      <OverviewGreeting />
      <AttentionStrip :submissions="submissions" :charges="charges" :loaded="submissionsLoaded" />

      <div class="overview__columns">
        <div class="overview__main">
          <MonthToDate :month="month" :state="monthState" :this-month="submissions?.thisMonth ?? null" />
          <MonthlyReportWidget />
        </div>
        <aside class="overview__side" aria-label="Latest activity">
          <RecentSubmissions :submissions="submissions" :loaded="submissionsLoaded" />
          <SiteHealth :lighthouse="lighthouse" :loaded="healthLoaded" />
        </aside>
      </div>

      <div v-if="extras.length" class="overview__extras">
        <component :is="extra" v-for="(extra, i) in extras" :key="i" />
      </div>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.overview { display: flex; flex-direction: column; gap: 1.5rem; max-width: 1400px; }
.overview__columns { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.overview__main, .overview__side { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
.overview__extras { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; }

@media (min-width: 1180px) {
  .overview__columns { grid-template-columns: minmax(0, 1.7fr) minmax(320px, 1fr); }
}
</style>
