# RMWS Dashboard

The private dashboard for Rocky Mountain Wireline Service: site analytics in plain language, quick links, and a way to send a support request. Sign-in is through Auth0.

Vite, Vue 3, TypeScript, Tailwind CSS 4, Pinia, Chart.js, Netlify Functions.

## Running it

```
pnpm install
pnpm dev           # the app and its server functions, at http://localhost:5173
```

`pnpm dev` runs the Netlify functions inside Vite, reading `.env`, so nothing else needs to be running. `pnpm build` type-checks the app and the functions, then builds.

## What is in it

| Section | Needs |
|---|---|
| Overview | Nothing. Links come from `src/config/dashboard.ts`. |
| Analytics | A Google service account with Viewer access to the GA4 property. |
| Monthly Reports | `TURSO_CONFIG`. Analytics and Search Console fill in their sections when connected. |
| Form Submissions | `TURSO_CONFIG`, and the public site set up to save submissions (see below). |
| Contact & Support | A Resend API key and a verified sending domain. |
| Billing | A Stripe key and the customer ID, with the customer portal switched on in Stripe. `TURSO_CONFIG` for offline payments. |
| Content Kit | Hidden while `contentKit.enabled` is `false` in the config. |

A section that is not set up is left out of the menu and has no route.

## Environment variables

`.env.example` lists every variable with a note on each. Only the two `VITE_AUTH0_*` values reach the browser; everything else is read by the server functions and must be set in Netlify.

### Connecting Google Analytics

1. In Google Cloud, create a service account and a JSON key for it. Enable the **Google Analytics Data API** on that project.
2. In GA4 Admin → Property access management, add the service account's email as a **Viewer**.
3. Set `GA4_PROPERTY_ID` (the numeric ID from Admin → Property details, not the `G-…` measurement ID), `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY` (the key's `private_key` value, on one line with `\n` for newlines).

Until these are set the Analytics page says it is being connected rather than showing an error.

### What the figures mean

Everything is counted in **engaged visits**: sessions that lasted ten seconds, opened a second page, or got in touch. Raw visitor counts are not shown, because well over half of this site's sessions are automated (a steady stream from Singapore and from cloud data centers that loads one page and leaves). The page states how many hits were left out.

The "People getting in touch" figures come from events the rebuilt public site sends: `generate_lead` (a form sent; counted as a job application when sent from `/employment`, otherwise as a contact form) and `contact_click` (a phone number or email address tapped). Until the first of these arrives, the section says it is not being counted yet rather than showing zeros.

### Connecting Search Console

The "What people searched on Google" section uses the same service account. Two steps, once:

1. In the service account's Google Cloud project, enable the **Google Search Console API**.
2. In Search Console → Settings → Users and permissions, add the service account's email as a user (Restricted is enough) on the rmws.com property.

No new variables are needed; the property is found by the client's domain. Set `GSC_SITE_URL` only to force a particular one. Search Console keeps sixteen months of data and runs about two days behind.

### Monthly reports

One snapshot per calendar month, kept in the agency database (`site_reports`, from `db/site-reports.sql`). The overview shows the newest; the Monthly Reports page has every month, and prints or saves as a PDF.

- **Written automatically** on the 3rd of each month at 14:00 UTC by the scheduled function `monthly-report`, for the month just ended. It skips a month that already has a report, so a retry never rewrites one the client has seen. Scheduled functions run only on the published production deploy.
- **Built by hand** with `pnpm reports:generate` (last month), `pnpm reports:generate 2026-09`, or `pnpm reports:generate --last 12`; add `--write` to save. This replaces an existing month.
- **Contents:** real visits against the month before and the same month a year earlier, inquiries counted from the submissions inbox, top pages, services, cities and sources, Google search terms when Search Console is connected, and three or four plain-English highlights.
- **Your own write-up:** a row for the month in the agency `monthly_reports` table with status `published` shows on the report as "From your web team" (its `summary` and `recommendations`). The dashboard only reads that table.

### Lighthouse

Google Lighthouse scores for the homepage, mobile and desktop, through the PageSpeed Insights API. They appear in the monthly report ("Speed and quality") and on the overview card.

- Uses the analytics service account; the only setup is enabling the **PageSpeed Insights API** in that account's Google Cloud project. (`PSI_API_KEY` can be set instead, but is not needed.)
- Tested on the 2nd of each month by the scheduled function `lighthouse-check`; the report written on the 3rd picks the result up. Run it by hand with `pnpm lighthouse:check` (add `--write` to save).
- A test measures the site as it is at that moment and cannot be run for a past date, so reports from before the first test have no Lighthouse section.
- `LIGHTHOUSE_URL` overrides the page tested.

### Form submissions

The public site saves each contact form and job application to the agency database as well as emailing it; this page lists them. A submission can be marked New, In progress, Done or Archived, given private notes, exported with the rest to CSV, or deleted. Résumés are stored with the submission and downloaded from here.

- Tables: `db/form-submissions.sql`, applied with `pnpm db:migrate` (additive; safe to re-run).
- The public site needs `TURSO_CONFIG` and `FORMS_CLIENT_ID` (this dashboard's `clientId`) in its own Netlify environment. Without them it emails only and nothing appears here.
- Earlier submissions from Netlify Forms are brought in with `node scripts/import-netlify-forms.mjs <folder of CSV exports> --write` (dry run without `--write`; safe to re-run). It fetches the attached résumés while their links still work, marks the last 30 days New and the rest Done, and leaves out spam-trap rows, IP addresses and browser strings.
- Which inbox a form lands in comes from its name: anything with "employ", "applic", "career" or "job" is a job application; "contact", "sales", "inquiry" or "quote" is a sales contact.

### Offline payments

Invoices paid by check or transfer are read from the agency database (`offline_invoices`, by this dashboard's client ID) and listed with the Stripe ones. A maintenance plan prepaid that way is shown as the subscription when Stripe has none running. Needs `TURSO_CONFIG`; turned on by `billing.showOfflineInvoices` in the config.

## Who can get in

Every function verifies the caller's Auth0 token with Auth0 before doing anything; a missing or invalid token gets a 401.

`ALLOWED_EMAILS` narrows access to named addresses or domains, for example `eric@ericphiferllc.com,@rmws.com`. If it is empty, any account in the Auth0 tenant is let in, so either set it or make sure sign-ups are disabled in Auth0.

The Auth0 application needs the dashboard's address in **Allowed Callback URLs**, **Allowed Logout URLs** and **Allowed Web Origins**.

## Deploying

Netlify builds the `production` branch. Day-to-day work goes to `sandbox`; branch deploys for `sandbox` should stay off so they cost no build credits.
