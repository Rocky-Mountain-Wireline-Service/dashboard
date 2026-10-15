# Client Dashboard Overview — Standard

The overview is the page a client lands on after signing in. This document is the standard for it across every client dashboard built from `pws-dashboard-template`. It describes what the page must do, how it is laid out, where its data comes from, and how it behaves when a data source is missing.

The reference implementation is the Rocky Mountain Wireline Service dashboard (repo `Rocky-Mountain-Wireline-Service/dashboard`, branch `sandbox`). File paths below are relative to that repo; copy from it rather than rewriting.

---

## 1. What the page is for

A client opens the dashboard for one of three reasons: to see whether anything needs them, to see how the website is doing, or to get something done (edit content, ask for a change). The overview answers all three on one screen, in that order, without the client having to know where anything lives.

Rules that follow from that:

- **Lead with the person, not the product.** The first thing on the page is a greeting by first name and the things they can do.
- **Show what is waiting before what is interesting.** New inquiries and unpaid invoices come before charts.
- **Live first, settled second.** "This month so far" (live, changes daily) sits above "last month's report" (a fixed snapshot).
- **Plain words, not metric names.** "Real visits", "Sales inquiries", "Job applications", "Down 33% on the same days last month". Never "sessions", "engaged sessions", "CTR".
- **No dead ends and no fake zeros.** A section without data says why in a sentence ("Visitor figures appear here once analytics is connected"); it never shows 0 for something that is not measured.
- **American English** throughout: inquiries, color, organization.

---

## 2. Layout

Read top to bottom. On wide screens the last part splits into a main column and a side column.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Good afternoon, Theron                    [View website] [Edit       │
│ Thursday, October 15 · Here's how X's website is doing.   content] [Request a change] │
├──────────────────────────────────────────────────────────────────────┤
│ ▌ 21 new job applications                                  Review → │   ← attention strip
├───────────────────────────────────────────┬──────────────────────────┤
│ October so far                 Analytics →│ Latest submissions  All →│
│  61 real visits      ▁▃▅▂▇▅▃▁▂▁▆▅▁         │  ● Name · Job app · 2d   │
│  Down 33% on the same days last month     │  ● Name · Sales · 5d     │
│  Sales inquiries 0 · Job apps 3 · 53s     │  …five rows              │
├───────────────────────────────────────────┤──────────────────────────┤
│ September 2026 report     Full report →   │ Site health  Report →    │
│  [181 visits][1 inquiry][20 apps][97/100] │  Phone  ◯97 ◯69 ◯100 ◯75 │
│  • highlight  • highlight  • highlight    │  Computer ◯98 ◯78 ◯100 ◯75│
│  Next report: November 3                  │  Lighthouse · tested Oct 15│
└───────────────────────────────────────────┴──────────────────────────┘
```

- Page container: `max-width: 1400px`, vertical gap `1.5rem`.
- Columns: one column below **1180px**; from 1180px, `minmax(0, 1.7fr) minmax(320px, 1fr)`.
- Every card uses the shared `.card` class (section 5). No widget draws its own box.
- Must work at 390px, 768px, 1024px, 1440px and 1920px with no horizontal overflow, and in dark mode.

Reference: `src/pages/DashboardHome.vue`.

---

## 3. The six parts

### 3.1 Greeting and quick actions — `src/components/overview/OverviewGreeting.vue`

- "Good morning / afternoon / evening, {first name}" from the Auth0 user's name (browser's local time). No name → just the greeting.
- Sub-line: today's date and "Here's how {clientName}'s website is doing."
- Quick actions as pill buttons, built from `config.links`, reworded as verbs:
  - a link whose label/URL mentions studio, sanity or cms → **Edit website content** (pen icon)
  - a link labeled live/site → **View website** (globe icon)
  - always last, in the brand color: **Request a change** → `/support`
- External links open in a new tab and say so to screen readers.

### 3.2 Attention strip — `src/components/overview/AttentionStrip.vue`

Only things the client should act on. One tile per item, linking straight to the filtered place to act:

| Item | Source | Link |
|---|---|---|
| "N new sales inquiries" | submissions with `status = new`, `kind = contact` | `/submissions?kind=contact&status=new` |
| "N new job applications" | same, `kind = application` | `/submissions?kind=application&status=new` |
| "Invoice for $X due {date}" | billing pending charges (Stripe open invoices + unpaid offline invoices) | `/billing` |

With nothing to show: a single green line, **"All caught up — nothing is waiting on you."** Hide entirely while loading. The submissions page must honor `?kind=` and `?status=` in the link.

### 3.3 This month so far — `src/components/overview/MonthToDate.vue`

- Title "{Month} so far", link to Analytics.
- Big number: **real visits** this calendar month (GA4 engaged sessions — see 4.2), with the change against **the same days of last month** in green/red.
- A daily sparkline (plain CSS bars, no chart library), today's bar faded because the day is not over. Hidden from screen readers, with a one-line text equivalent.
- Footer row: Sales inquiries and Job applications **this month, counted from the submissions inbox** (not GA), and average time per visit.

### 3.4 Last month's report — `src/components/widgets/MonthlyReportWidget.vue`

The newest stored monthly report: four figure tiles (real visits, sales inquiries, job applications, and phone speed score if a Lighthouse test exists — otherwise Google clicks, otherwise average visit length), three to five plain-English highlight sentences, "Full report →", and "Next report: {date}". Tiles go two across on phones.

### 3.5 Latest submissions — `src/components/overview/RecentSubmissions.vue`

Five newest non-archived submissions: initials avatar (brand red for sales, gold for applications), name or email, type, "2 days ago", and a gold **NEW** pill when unread. "View all →".

### 3.6 Site health — `src/components/overview/SiteHealth.vue`

The latest Google Lighthouse test: phone and computer rows, four score rings each (Speed, Access, Practices, Search) in Lighthouse's bands — 90+ green, 50–89 amber, below 50 red — and "tested {date}". Link to the report.

---

## 4. Data and endpoints

All data comes through the dashboard's own Netlify functions, every one of which verifies the Auth0 token (`netlify/lib/auth.ts`) and filters by `config.clientId`. The overview loads its sources **in parallel and independently** (`src/composables/useOverview.ts`): a slow or failing source leaves its own card in an empty state and never blocks the others.

| Card | Endpoint | Notes |
|---|---|---|
| Attention, Month footer, Latest submissions | `GET form-submissions?summary=1` | `{ counts[], thisMonth{contact, application}, recent[5] }`. "This month" is computed in the client's timezone (`GA4_TIMEZONE`, default America/Denver). |
| This month so far | `GET analytics-proxy?period=mtd` | Month to date vs the same days last month, daily series. |
| Last month's report | `GET reports` | Newest stored snapshot (`site_reports` table). |
| Site health | `GET site-health` | Newest row in `site_checks` with `kind = 'lighthouse'`. |
| Attention (invoices) | `GET stripe-get-billing-summary` | Only when billing is enabled in config. |

### 4.1 Prerequisites per card

A dashboard may not have every feature yet. Build the missing feature first where it matters, or ship the card in its empty state:

| Card | Needs | Without it |
|---|---|---|
| Greeting | Auth0 | — |
| Attention, Latest submissions, inquiry counts | Form submissions inbox (`db/form-submissions.sql`, site saves submissions) | "All caught up" / "Nothing yet" |
| This month so far | GA4 service account (`GA4_PROPERTY_ID`, `GA4_CLIENT_EMAIL`, `GA4_PRIVATE_KEY`) | "Visitor figures appear here once analytics is connected" |
| Last month's report | Monthly reports (`db/site-reports.sql`, `monthly-report` scheduled function) | "Your first monthly report will appear here early next month" |
| Site health | Lighthouse checks (`db/site-checks.sql`, `lighthouse-check` scheduled function; PageSpeed Insights API enabled in the service account's project — no API key needed) | Explains the monthly test |
| Invoice items | Stripe billing (`STRIPE_CONFIG`, `STRIPE_CUSTOMER_ID`) and optionally offline invoices from Turso | No invoice tiles |

### 4.2 Counting visits

Use GA4 **engaged sessions** ("real visits": 10+ seconds, a second page, or a conversion), never raw users or sessions. On RMWS more than half of raw sessions were automated (Singapore and cloud data centers), which doubled every figure and made "Direct" look like the main source. Say on the analytics page how many hits were left out.

### 4.3 Counting inquiries

Count inquiries and applications from the submissions inbox, which is complete and accurate for past months. GA4 lead events only exist from the day the rebuilt site sends them; until then, never show their zeros.

---

## 5. Design tokens and the card

Set in `src/assets/styles/theme.css` and `src/assets/styles/main.css`. These replace the template's flat look (gray boxes on white, square corners).

```css
:root {
  --color-bg: #f6f4f5;          /* warm off-white page */
  --color-surface: #ffffff;     /* cards */
  --color-border: #e6e2e5;      /* lighter lines */
  --shadow-card: 0 1px 2px rgba(56, 5, 6, 0.04), 0 2px 8px rgba(56, 5, 6, 0.05);
  --border-radius: 0.5rem;
  --color-on-primary: #ffffff;  /* text on the brand color, both themes */
  --color-up: #15803d;  --color-down: #b91c1c;  /* trend text, AA on white */
  --color-warn: #92400e; --color-info: #4338ca;
}
[data-theme="dark"] {
  --color-bg: #12151f;  --color-surface: #1d2230;  --color-border: #343a4b;
  --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.3);
  --color-up: #4ade80;  --color-down: #f87171;  --color-warn: #fbbf24;  --color-info: #a5b4fc;
}
```

Tint the shadow with the client's darkest brand color (RMWS uses its sidebar maroon, `rgba(56, 5, 6, …)`); keep the alpha values.

```css
.card { background: var(--color-surface); border: 1px solid var(--color-border);
        border-radius: calc(var(--border-radius) * 1.5); box-shadow: var(--shadow-card);
        padding: 1.25rem 1.5rem; }
.card__head  { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .25rem 1rem; margin-bottom: 1rem; }
.card__title { display: flex; align-items: center; gap: .5rem; font-family: var(--font-heading); font-size: 1rem; font-weight: 700; }
.card__link  { font-size: .8125rem; font-weight: 600; color: var(--color-primary); }
.card__empty { font-size: .875rem; color: var(--color-text-secondary); }
```

- Fonts: the same heading and body fonts as the client's public site, self-hosted (`@fontsource-variable/*`), never from Google's CDN.
- Each card title has a Lucide icon at 18px.
- Hover movement only under `prefers-reduced-motion: no-preference`.
- Text on the brand color uses `--color-on-primary`, never `--color-text-inverse` (which turns dark in dark mode).

### Sidebar brand

Show the client's **favicon badge** at the top of the sidebar instead of the template's initial letter: their square favicon / app icon (the 180px `apple-touch-icon.png` from the public site), copied into the dashboard's `public/` and set as `config.logo` (e.g. `/brand-badge.png`). It is shown as it is at 44px, so it must be a self-contained mark that reads on the dark sidebar; a wide wordmark logo is too small at that size. The client name beside it wraps to two lines before truncating. Fallback when no badge is configured: the initial letter, as before.

Reference: `src/components/layout/DashboardSidebar.vue` (`.sidebar__logo`).

---

## 6. Accessibility

- One `h2` per card; the page `h1` is the top bar title.
- Status and loading text in `role="status"`; errors in `role="alert"`.
- Charts and sparklines are `aria-hidden` and paired with a one-sentence text summary.
- Trend colors meet WCAG AA as small text on the card surface in both themes (the tokens above do).
- Every link and button is reachable and visibly focused; external links announce that they open a new tab.

---

## 7. Checklist for applying this to another dashboard

1. Copy `src/assets/styles/theme.css` token changes and the `.card` block in `main.css`; adjust brand colors and the shadow tint.
2. Copy `src/composables/useOverview.ts`, `src/components/overview/*`, `src/components/widgets/MonthlyReportWidget.vue`, `src/composables/useReports.ts`, `src/types/report.ts`, and `src/pages/DashboardHome.vue`.
3. Add the endpoints the cards need (section 4): `form-submissions` (with `?summary=1`), `analytics-proxy` (with `period=mtd`), `reports`, `site-health`. Each must use `requireUser` and filter by `config.clientId`.
4. Make the submissions page read `?kind=` and `?status=` from the URL.
5. Copy the public site's `apple-touch-icon.png` into the dashboard's `public/` (e.g. as `brand-badge.png`), set `logo` in the dashboard config, and update the sidebar.
6. Set `clientName` and `links` in `src/config/dashboard.ts` so the quick actions read well (a Studio link and a live-site link).
7. Check the page at 390, 768, 1024, 1440 and 1920px in light and dark, with every data source both present and absent.
8. Remove the template's standalone Links and Analytics widgets from the overview; their content now lives in the greeting and "so far" card.
