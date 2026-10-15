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
  inquiries: {
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
  lighthouse: LighthouseCheck | null;
  highlights: string[];
}

export type Rating = 'good' | 'needs-work' | 'poor';

export interface LighthouseResult {
  strategy: 'mobile' | 'desktop';
  scores: { performance: number; accessibility: number; bestPractices: number; seo: number };
  metrics: {
    lcp: { value: number; rating: Rating };
    cls: { value: number; rating: Rating };
    tbt: { value: number; rating: Rating };
  };
}

export interface LighthouseCheck {
  url: string;
  checkedAt: string;
  mobile: LighthouseResult | null;
  desktop: LighthouseResult | null;
}

export interface ReportNotes {
  summary: string;
  recommendations: string;
}
