<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import DashboardLayout from '@/components/layout/DashboardLayout.vue';
import {
  LayoutDashboard,
  Inbox,
  FileBarChart,
  BarChart3,
  ClipboardList,
  MessageSquare,
  CreditCard,
  Video,
  LifeBuoy,
  ChevronDown,
  ChevronRight,
} from 'lucide-vue-next';
import config, { features } from '@/config/dashboard';

/**
 * Help & How-To: what each part of the dashboard does, in plain language.
 *
 * Sections for optional features follow the same `features` flags as the
 * sidebar and router, so the page never explains something the client can't
 * open. Every statement here describes this dashboard as built; when a page
 * changes, its section here should change with it.
 */

const showTutorials = config.enabledWidgets.includes('tutorials') && config.tutorialVideos.length > 0;

const expanded = ref<Record<string, boolean>>({ overview: true });

function toggle(key: string) {
  expanded.value[key] = !expanded.value[key];
}
</script>

<template>
  <DashboardLayout page-title="Help & How-To">
    <div class="help">
      <p class="help__intro">
        This page explains what each part of your dashboard does and how to use it.
        Still stuck? Send a message from
        <RouterLink to="/support">Contact &amp; Support</RouterLink>
        and we'll get back to you within one business day.
      </p>

      <!-- Overview -->
      <section class="help__section">
        <h2 class="help__heading">
          <button type="button" class="help__header" :aria-expanded="!!expanded.overview" aria-controls="help-overview" @click="toggle('overview')">
            <LayoutDashboard :size="20" aria-hidden="true" />
            <span class="help__title">Overview</span>
            <component :is="expanded.overview ? ChevronDown : ChevronRight" :size="18" class="help__chevron" aria-hidden="true" />
          </button>
        </h2>
        <div v-if="expanded.overview" id="help-overview" class="help__body">
          <p>The first page you see after signing in. It brings together what needs your attention and how the site is doing:</p>
          <ul>
            <li><strong>Needs attention:</strong> new sales inquiries, new job applications<template v-if="features.billing"> and any invoice that's due</template>, each with a button that takes you straight to it.</li>
            <li><strong>This month so far:</strong> real visits to the website since the 1st.</li>
            <li><strong>Your latest monthly report</strong>, with a link to the full report.</li>
            <li><strong>Recent submissions:</strong> the newest messages and applications from the website.</li>
            <li><strong>Site health:</strong> the latest results of Google's speed and quality test, which runs on the 2nd of each month.</li>
          </ul>
          <p>Use the menu on the left to open any section. On a phone, the menu button at the top opens it.</p>
        </div>
      </section>

      <!-- Form Submissions -->
      <section class="help__section">
        <h2 class="help__heading">
          <button type="button" class="help__header" :aria-expanded="!!expanded.submissions" aria-controls="help-submissions" @click="toggle('submissions')">
            <Inbox :size="20" aria-hidden="true" />
            <span class="help__title">Form Submissions</span>
            <component :is="expanded.submissions ? ChevronDown : ChevronRight" :size="18" class="help__chevron" aria-hidden="true" />
          </button>
        </h2>
        <div v-if="expanded.submissions" id="help-submissions" class="help__body">
          <p>
            Every message and job application sent through the forms on {{ config.clientDomain }} lands here,
            including any résumés attached. A copy of each one is also sent by email.
          </p>
          <ul>
            <li><strong>Find what you need:</strong> switch between Sales contacts and Job applications at the top, filter by status, or search by name, email or message.</li>
            <li><strong>Keep track:</strong> mark each one New, In progress, Done or Archived, so everyone who signs in can see what's been handled.</li>
            <li><strong>Notes:</strong> add a note to any submission, such as "Called back, left a voicemail." Only people who sign in to this dashboard can see notes.</li>
            <li><strong>Attachments:</strong> download a résumé or other file from the submission it came with.</li>
            <li><strong>Export:</strong> download the list you're looking at as a spreadsheet file.</li>
            <li><strong>Delete:</strong> removes a submission and its attachments for good. Archiving is the safer choice if you might need it later.</li>
          </ul>
          <p class="help__note">
            Submissions that look like spam, such as messages full of links, are filed under
            <strong>Archived</strong> automatically with a note saying why, rather than thrown away.
            If a real message ever ends up there, change its status back to New.
          </p>
        </div>
      </section>

      <!-- Monthly Reports -->
      <section class="help__section">
        <h2 class="help__heading">
          <button type="button" class="help__header" :aria-expanded="!!expanded.reports" aria-controls="help-reports" @click="toggle('reports')">
            <FileBarChart :size="20" aria-hidden="true" />
            <span class="help__title">Monthly Reports</span>
            <component :is="expanded.reports ? ChevronDown : ChevronRight" :size="18" class="help__chevron" aria-hidden="true" />
          </button>
        </h2>
        <div v-if="expanded.reports" id="help-reports" class="help__body">
          <p>
            A report for each month is written in the first days of the following month and kept here,
            so you can look back at earlier months.
          </p>
          <ul>
            <li><strong>The month in brief:</strong> visits, compared with the month before and the same month last year.</li>
            <li><strong>People getting in touch:</strong> how many sales inquiries and job applications came in.</li>
            <li><strong>How people found the site</strong>, the most visited pages, which services people looked at, and where visitors were.</li>
            <li><strong>Google search:</strong> how often the site was shown in Google results and how often people clicked through.</li>
            <li><strong>Speed and quality:</strong> the results of Google's monthly test of the site.</li>
            <li><strong>From your web team:</strong> any notes or recommendations we've added for that month.</li>
          </ul>
          <p>Use the month selector at the top of the page to open an earlier report.</p>
        </div>
      </section>

      <!-- Analytics -->
      <section class="help__section">
        <h2 class="help__heading">
          <button type="button" class="help__header" :aria-expanded="!!expanded.analytics" aria-controls="help-analytics" @click="toggle('analytics')">
            <BarChart3 :size="20" aria-hidden="true" />
            <span class="help__title">Analytics</span>
            <component :is="expanded.analytics ? ChevronDown : ChevronRight" :size="18" class="help__chevron" aria-hidden="true" />
          </button>
        </h2>
        <div v-if="expanded.analytics" id="help-analytics" class="help__body">
          <p>
            The live view of who's visiting the website. Choose a time period at the top, from this month
            back to all time; each figure is compared with the period before.
          </p>
          <ul>
            <li><strong>Real visits:</strong> visits by people, with automated traffic such as search engine robots left out.</li>
            <li><strong>Average time per visit</strong>, how many visits were on a phone, and how many people had visited before.</li>
            <li><strong>How people found you:</strong> Google, a direct link, social media, another website and so on.</li>
            <li><strong>Most visited pages</strong> and <strong>which services people look at</strong>.</li>
            <li><strong>People getting in touch:</strong> form submissions and taps on the phone number or email address.</li>
            <li><strong>What people searched on Google</strong> to find the site, and <strong>where your visitors are</strong> by town and city.</li>
          </ul>
          <p class="help__note">
            Figures update through the day. The most recent few hours can take a little while to appear,
            so today's numbers may still be filling in.
          </p>
        </div>
      </section>

      <!-- Content Kit -->
      <section v-if="features.contentKit" class="help__section">
        <h2 class="help__heading">
          <button type="button" class="help__header" :aria-expanded="!!expanded.contentKit" aria-controls="help-content-kit" @click="toggle('contentKit')">
            <ClipboardList :size="20" aria-hidden="true" />
            <span class="help__title">Content Kit</span>
            <component :is="expanded.contentKit ? ChevronDown : ChevronRight" :size="18" class="help__chevron" aria-hidden="true" />
          </button>
        </h2>
        <div v-if="expanded.contentKit" id="help-content-kit" class="help__body">
          <p>
            Where you tell us about your business so the content on your site stays accurate. What you
            save here doesn't change the website by itself; send us a note from Contact &amp; Support when
            you'd like us to apply it.
          </p>
          <ul>
            <li>Mark each section complete when you've finished it; the next unfinished one opens for you.</li>
            <li>The progress bar at the top shows how much of the kit is done.</li>
            <li>Fill in what applies to you and skip what doesn't.</li>
          </ul>
        </div>
      </section>

      <!-- Contact & Support -->
      <section class="help__section">
        <h2 class="help__heading">
          <button type="button" class="help__header" :aria-expanded="!!expanded.support" aria-controls="help-support" @click="toggle('support')">
            <MessageSquare :size="20" aria-hidden="true" />
            <span class="help__title">Contact &amp; Support</span>
            <component :is="expanded.support ? ChevronDown : ChevronRight" :size="18" class="help__chevron" aria-hidden="true" />
          </button>
        </h2>
        <div v-if="expanded.support" id="help-support" class="help__body">
          <p>The quickest way to reach us. Choose a category, add a subject and describe what you need; we'll get back to you within one business day.</p>
          <ul>
            <li><strong>Bug Report:</strong> something isn't working, such as a broken link, a missing image or a form that won't send.</li>
            <li><strong>Update Request:</strong> a change you'd like us to make to the website.</li>
            <li><strong>Question:</strong> anything you're unsure about, or want our view on.</li>
            <li><strong>Other:</strong> anything that doesn't fit the above.</li>
          </ul>
          <p class="help__note">
            If something is urgent, such as the website being down, put "URGENT" at the start of the subject so it's seen first.
          </p>
        </div>
      </section>

      <!-- Billing -->
      <section v-if="features.billing" class="help__section">
        <h2 class="help__heading">
          <button type="button" class="help__header" :aria-expanded="!!expanded.billing" aria-controls="help-billing" @click="toggle('billing')">
            <CreditCard :size="20" aria-hidden="true" />
            <span class="help__title">Billing</span>
            <component :is="expanded.billing ? ChevronDown : ChevronRight" :size="18" class="help__chevron" aria-hidden="true" />
          </button>
        </h2>
        <div v-if="expanded.billing" id="help-billing" class="help__body">
          <p>Your plan, payments and anything that's due.</p>
          <ul>
            <li><strong>Subscription:</strong> your current plan and its status.</li>
            <li><strong>Pending charges:</strong> invoices still to be paid. <strong>Pay Now</strong> opens a secure payment page from our payment provider, Stripe.</li>
            <li><strong>Recent payments</strong> and the payment method on file.</li>
            <li><strong>Manage Subscription</strong> and <strong>View All Invoices</strong> open your secure billing portal at Stripe. That's where you update your card, change how you pay and download past invoices.</li>
          </ul>
          <p class="help__note">
            Card details are entered only on Stripe's secure pages, never on this dashboard. Questions about an invoice? Send a note from Contact &amp; Support with the invoice number.
          </p>
        </div>
      </section>

      <!-- Tutorial videos -->
      <section v-if="showTutorials" class="help__section">
        <h2 class="help__heading">
          <button type="button" class="help__header" :aria-expanded="!!expanded.tutorials" aria-controls="help-tutorials" @click="toggle('tutorials')">
            <Video :size="20" aria-hidden="true" />
            <span class="help__title">Tutorial videos</span>
            <component :is="expanded.tutorials ? ChevronDown : ChevronRight" :size="18" class="help__chevron" aria-hidden="true" />
          </button>
        </h2>
        <div v-if="expanded.tutorials" id="help-tutorials" class="help__body">
          <p>Walk-throughs we've recorded for your site. Each opens in a new tab:</p>
          <ul>
            <li v-for="video in config.tutorialVideos" :key="video.url">
              <a :href="video.url" target="_blank" rel="noopener">{{ video.title }}</a>
            </li>
          </ul>
        </div>
      </section>

      <!-- Troubleshooting -->
      <section class="help__section">
        <h2 class="help__heading">
          <button type="button" class="help__header" :aria-expanded="!!expanded.troubleshooting" aria-controls="help-troubleshooting" @click="toggle('troubleshooting')">
            <LifeBuoy :size="20" aria-hidden="true" />
            <span class="help__title">Troubleshooting</span>
            <component :is="expanded.troubleshooting ? ChevronDown : ChevronRight" :size="18" class="help__chevron" aria-hidden="true" />
          </button>
        </h2>
        <div v-if="expanded.troubleshooting" id="help-troubleshooting" class="help__body">
          <dl class="help__faq">
            <dt>I can't sign in.</dt>
            <dd>Sign in with the email address we set up for you; other addresses are turned away even if the password is right. If the sign-in page keeps coming back, clear this site's cookies and try again. Someone new on your team needs access? Ask us from Contact &amp; Support.</dd>

            <dt>A message came in by email but I can't find it here.</dt>
            <dd>The list starts out showing everything that isn't archived. Likely spam is filed under <strong>Archived</strong>, so set the status filter to <strong>Everything</strong> and search for the sender's name or email.</dd>

            <dt>This month's report isn't here yet.</dt>
            <dd>Each month's report is written in the first days of the following month. If it's past the 5th and the report still hasn't appeared, let us know.</dd>

            <dt>A section says it's "being connected".</dt>
            <dd>That part of the dashboard is still being set up on our side. It will fill in once the connection is finished; no action is needed from you.</dd>

            <template v-if="features.contentKit">
              <dt>I made changes in Content Kit but don't see them on my site.</dt>
              <dd>Content Kit stores what you tell us; it doesn't change the website by itself. Send a note from Contact &amp; Support when you're ready for us to apply the updates.</dd>
            </template>
          </dl>
        </div>
      </section>
    </div>
  </DashboardLayout>
</template>

<style scoped>
.help {
  max-width: 820px;
  margin: 0 auto;
  padding: 1rem 0;
}

.help__intro {
  color: var(--color-text-secondary, var(--color-text));
  font-size: 0.9375rem;
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.help__intro a,
.help__body a {
  color: var(--color-primary);
}

.help__section {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  margin-bottom: 0.75rem;
  overflow: hidden;
}

/* The heading carries the outline for screen readers; the button inside it
   supplies the look. */
.help__heading {
  margin: 0;
  font-size: inherit;
}

.help__header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-text);
  text-align: left;
  font-size: 0.9375rem;
  font-weight: 600;
  font-family: var(--font-heading);
}

.help__header:hover {
  background-color: var(--color-border);
}

.help__title {
  flex: 1;
}

.help__chevron {
  color: var(--color-text-secondary, var(--color-text));
  flex-shrink: 0;
}

.help__body {
  padding: 1rem 1.25rem 1.25rem;
  color: var(--color-text);
  font-size: 0.9375rem;
  line-height: 1.65;
  border-top: 1px solid var(--color-border);
}

.help__body ul {
  padding-left: 1.25rem;
  margin: 0.5rem 0;
}

.help__body li {
  margin: 0.4rem 0;
}

.help__body p {
  margin: 0.5rem 0;
}

.help__note {
  background-color: var(--color-border);
  border-left: 3px solid var(--color-primary);
  padding: 0.75rem 1rem;
  border-radius: 0 var(--border-radius) var(--border-radius) 0;
  font-size: 0.875rem;
  margin-top: 0.75rem;
}

.help__faq dt {
  font-weight: 600;
  color: var(--color-text);
  margin-top: 1rem;
}

.help__faq dt:first-child {
  margin-top: 0;
}

.help__faq dd {
  margin: 0.25rem 0 0;
  color: var(--color-text-secondary, var(--color-text));
}
</style>
