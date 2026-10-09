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
| Contact & Support | A Resend API key and a verified sending domain. |
| Billing | Hidden until `billing.stripeCustomerId` is added to the config. |
| Content Kit | Hidden while `contentKit.enabled` is `false` in the config. |

A section that is not set up is left out of the menu and has no route.

## Environment variables

`.env.example` lists every variable with a note on each. Only the two `VITE_AUTH0_*` values reach the browser; everything else is read by the server functions and must be set in Netlify.

### Connecting Google Analytics

1. In Google Cloud, create a service account and a JSON key for it. Enable the **Google Analytics Data API** on that project.
2. In GA4 Admin → Property access management, add the service account's email as a **Viewer**.
3. Set `GA4_PROPERTY_ID` (the numeric ID from Admin → Property details, not the `G-…` measurement ID), `GA4_CLIENT_EMAIL` and `GA4_PRIVATE_KEY` (the key's `private_key` value, on one line with `\n` for newlines).

Until these are set the Analytics page says it is being connected rather than showing an error.

The "People getting in touch" figures come from three events the public site sends: `generate_lead` (a form sent), `contact_click` (a phone number or email address tapped) and `quote_cta_click` (a Contact Sales button).

## Who can get in

Every function verifies the caller's Auth0 token with Auth0 before doing anything; a missing or invalid token gets a 401.

`ALLOWED_EMAILS` narrows access to named addresses or domains, for example `eric@ericphiferllc.com,@rmws.com`. If it is empty, any account in the Auth0 tenant is let in, so either set it or make sure sign-ups are disabled in Auth0.

The Auth0 application needs the dashboard's address in **Allowed Callback URLs**, **Allowed Logout URLs** and **Allowed Web Origins**.

## Deploying

Netlify builds the `production` branch. Day-to-day work goes to `sandbox`; branch deploys for `sandbox` should stay off so they cost no build credits.
