export type WidgetType =
  | 'siteAnalytics'
  | 'tutorials'
  | 'links'
  | 'contentEditors';

export interface TutorialVideo {
  title: string;
  url: string;
  category?: string;
  description?: string;
}

/**
 * Unified dashboard link. Without a description renders as a compact pill
 * (the former Quick Action). With a description renders as a resource card
 * (the former Helpful Link).
 */
export interface DashboardLink {
  label: string;
  url: string;
  emoji?: string;
  description?: string;
}

export interface ContentEditor {
  label: string;
  documentType: string;
  description?: string;
}

/**
 * The Stripe customer itself is not here: it lives in the server's environment
 * (STRIPE_CUSTOMER_ID), where a request cannot change it.
 */
export interface BillingConfig {
  enabled: boolean;
  showPendingCharges: boolean;
  showOfflineInvoices: boolean;
}

export interface AnalyticsConfig {
  provider: 'simple-analytics' | 'ga4';
  /** Simple Analytics: client domain (e.g. "acmeplumbing.com") */
  simpleAnalyticsId?: string;
  /** GA4: measurement ID (e.g. "G-XXXXXXXXXX") */
  analyticsId?: string;
  /** Dashboard routes filtered from public traffic view */
  internalRoutes?: string[];
  /** Goal page slug for visitor journey funnel (default: '/contact') */
  conversionPage?: string;
}

export interface ContentKitSection {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  required: boolean;
}

export interface ContentKitConfig {
  enabled: boolean;
  sections: ContentKitSection[];
  maxPersonalityPicks?: number;
  welcomeMessage?: string;
  completionEmailNotify?: boolean;
}

export interface DashboardConfig {
  clientId: string;
  clientName: string;
  clientDomain: string;
  clientEmail: string;
  enabledWidgets: string[];
  tutorialVideos: TutorialVideo[];
  links: DashboardLink[];
  contentEditors: ContentEditor[];
  billing?: BillingConfig;
  analytics?: AnalyticsConfig;
  contentKit?: ContentKitConfig;
}
