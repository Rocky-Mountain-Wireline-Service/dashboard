/**
 * A stored monthly report, as the reports function returns it. Mirrors
 * MonthlyReport in netlify/lib/report.ts, which builds it.
 */
export interface MonthlyReport {
  month: string;
  generatedAt: string;
  traffic: {
    visits: number;
    prevVisits: number;
    lastYearVisits: number | null;
    allVisits: number;
    avgSeconds: number;
    mobileShare: number | null;
    returningShare: number | null;
  } | null;
  series: { day: string; visits: number }[];
  enquiries: {
    contactForms: number;
    applications: number;
    prevContactForms: number;
    prevApplications: number;
    stillNew: number;
    phoneEmailTaps: number | null;
  };
  pages: { path: string; visits: number }[];
  services: { name: string; visits: number }[];
  cities: { name: string; region: string; visits: number }[];
  sources: { source: string; medium: string; visits: number }[];
  search: {
    clicks: number;
    impressions: number;
    position: number | null;
    prevClicks: number;
    queries: { query: string; clicks: number; impressions: number; position: number }[];
  } | null;
  highlights: string[];
}

export interface ReportNotes {
  summary: string;
  recommendations: string;
}
