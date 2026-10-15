import { ref } from 'vue';
import { useApi } from '@/composables/useApi';
import type { MonthlyReport, ReportNotes } from '@/types/report';

export function useReports() {
  const api = useApi();
  const state = ref<'loading' | 'ready' | 'empty' | 'setup' | 'error'>('loading');
  const report = ref<MonthlyReport | null>(null);
  const notes = ref<ReportNotes | null>(null);
  const months = ref<string[]>([]);
  const message = ref('');

  async function load(month?: string) {
    state.value = 'loading';
    message.value = '';
    try {
      const res = await api(`reports${month ? `?month=${encodeURIComponent(month)}` : ''}`);
      const data = await res.json().catch(() => null);
      if (!data || typeof data !== 'object') throw new Error('The reports service is not responding.');
      if (data.configured === false) {
        state.value = 'setup';
        return;
      }
      if (!res.ok) throw new Error(data.error || 'The report could not be loaded.');

      months.value = data.months ?? [];
      report.value = data.report ?? null;
      notes.value = data.notes ?? null;
      state.value = report.value ? 'ready' : 'empty';
    } catch (err) {
      message.value = err instanceof Error ? err.message : 'The report could not be loaded.';
      state.value = 'error';
    }
  }

  return { state, report, notes, months, message, load };
}

/** "2026-09" as "September 2026". */
export const monthName = (month: string, style: 'long' | 'short' = 'long') =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: style, year: 'numeric', timeZone: 'UTC' });

/** When the next report will appear, given the newest one's month. */
export function nextReportDate(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  // The report for the month after this one is written on the 3rd of the
  // month after that: September's next is October's, ready November 3.
  // (Date.UTC counts months from 0, so index m+1 is two months on from m.)
  return new Date(Date.UTC(y, m + 1, 3, 12)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** A change against an earlier figure, in words; '' when there is nothing to compare. */
export function changeWords(now: number, before: number | null | undefined, against: string): string {
  if (!before) return '';
  const pct = Math.round(((now - before) / before) * 100);
  if (Math.abs(pct) <= 5) return `About the same as ${against}`;
  return `${pct > 0 ? 'Up' : 'Down'} ${Math.abs(pct)}% on ${against}`;
}

export const changeDirection = (now: number, before: number | null | undefined): 'up' | 'down' | 'flat' => {
  if (!before) return 'flat';
  const pct = ((now - before) / before) * 100;
  return pct > 5 ? 'up' : pct < -5 ? 'down' : 'flat';
};
