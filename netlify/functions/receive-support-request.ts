import { Resend } from 'resend';
import { json, requireUser } from '../lib/auth';

/**
 * Emails a support request from the dashboard to whoever looks after the site.
 *
 * Env:
 *   RESEND_API_KEY       Resend API key
 *   SUPPORT_TO_EMAIL     where requests are delivered
 *   SUPPORT_FROM_EMAIL   a sender on a domain verified in Resend
 */

const CATEGORIES: Record<string, string> = {
  bug: 'Bug Report',
  update: 'Update Request',
  question: 'Question',
  other: 'Other',
};

const MAX_SUBJECT = 200;
const MAX_MESSAGE = 10_000;

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
}) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.SUPPORT_TO_EMAIL;
  const from = process.env.SUPPORT_FROM_EMAIL;
  if (!apiKey || !to || !from) {
    console.error('Support email is not configured (RESEND_API_KEY, SUPPORT_TO_EMAIL, SUPPORT_FROM_EMAIL).');
    return json(503, {
      error: 'Support requests cannot be sent from here yet. Please email us directly.',
    });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Malformed request.' });
  }

  const text = (key: string) => String(body[key] ?? '').trim();
  const subject = text('subject').slice(0, MAX_SUBJECT);
  const message = text('message').slice(0, MAX_MESSAGE);
  if (!subject || !message) return json(400, { error: 'A subject and a message are required.' });

  const category = CATEGORIES[text('category')] ?? CATEGORIES.other;
  const name = text('name') || auth.user.name || 'Dashboard user';
  // The reply address is the one typed into the form when it is usable, and
  // the signed-in account otherwise. Both are shown so a mistyped address
  // cannot leave the request unanswerable.
  const typedEmail = text('email');
  const replyTo = isEmail(typedEmail) ? typedEmail : auth.user.email;
  const site = text('clientDomain') || text('clientName') || 'the website';

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:8px 12px;font-weight:600;color:#4b5563;vertical-align:top;width:150px;border-bottom:1px solid #f1f1f1;">${label}</td>
      <td style="padding:8px 12px;color:#1f2937;border-bottom:1px solid #f1f1f1;">${value}</td>
    </tr>`;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to,
      ...(replyTo ? { replyTo } : {}),
      subject: `[${category}] ${subject} — ${site}`,
      html: `
        <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;">
          <h2 style="color:#710a0c;margin:0 0 6px;">${escapeHtml(subject)}</h2>
          <p style="margin:0 0 20px;font-size:13px;color:#6b7280;">Support request from the ${escapeHtml(site)} dashboard</p>
          <table style="width:100%;border-collapse:collapse;">
            ${row('Category', escapeHtml(category))}
            ${row('From', escapeHtml(name))}
            ${row('Reply to', escapeHtml(replyTo ?? 'not given'))}
            ${row('Signed in as', escapeHtml(auth.user.email ?? auth.user.sub))}
          </table>
          <p style="margin:20px 0 0;color:#1f2937;line-height:1.6;">${escapeHtml(message).replace(/\n/g, '<br />')}</p>
        </div>`,
    });

    if (error) {
      console.error('Resend error:', error);
      return json(502, { error: 'Your request could not be sent. Please try again.' });
    }
    return json(200, { success: true });
  } catch (err) {
    console.error('receive-support-request failed:', err instanceof Error ? err.message : err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}
