import { timingSafeEqual } from 'node:crypto';
import { json, requireUser } from '../lib/auth';
import { pipeline, pipelineConfigured } from '../lib/pipeline';
import { localMidnightUtc, monthBounds } from '../lib/report';
import { reportTimeZone } from '../lib/google';

/**
 * The dashboard's inbox of website form submissions, stored in the agency
 * database through the Pipeline (client-form-submissions) with this
 * dashboard's key. The Pipeline resolves the client from the key, so no
 * request can reach another client's rows.
 *
 * Two kinds of caller:
 *
 *   The signed-in client (Auth0, netlify/lib/auth.ts):
 *     GET                         list, newest first (?kind=&status=&q=&offset=)
 *     GET    ?all=1               the same list unpaged, for an export
 *     GET    ?summary=1           counts, this month's counts, and the five newest — for the overview
 *     GET    ?id=…                one submission, with its attachments listed
 *     GET    ?file=…              one attachment, as base64
 *     PATCH  { id, status?, notes? }
 *     DELETE { id }
 *
 *   The website (frontend send-message.ts), with FORMS_INTAKE_SECRET in the
 *   `X-Forms-Secret` header:
 *     POST   { formSlug, formTitle, pagePath, fields[], files[], status?, notes? }
 *
 * The secret can add a submission to this client's inbox and do nothing else;
 * the website never holds the dashboard key.
 */

/** Query keys passed through to the Pipeline; anything else is dropped. */
const PASS_THROUGH = ['kind', 'status', 'q', 'offset', 'all', 'id', 'file'];

function intakeAllowed(headers: Record<string, string | undefined>): boolean {
  const expected = process.env.FORMS_INTAKE_SECRET;
  const given = headers['x-forms-secret'] || headers['X-Forms-Secret'];
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Which inbox a form belongs in, from what the form is called. */
function kindOf(slug: string, title: string): 'contact' | 'application' | 'other' {
  const text = `${slug} ${title}`.toLowerCase();
  if (/employ|applic|career|job|hiring/.test(text)) return 'application';
  if (/contact|sales|inquir|enquir|quote|message/.test(text)) return 'contact';
  return 'other';
}

async function intake(body: string | null) {
  if (!pipelineConfigured()) return json(503, { error: 'Inbox not configured' });

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }
  const formTitle = String(input.formTitle ?? '').trim();
  if (!formTitle || !Array.isArray(input.fields)) return json(400, { error: 'Expected { formTitle, fields[] }' });

  try {
    const saved = await pipeline('client-form-submissions', {
      method: 'POST',
      body: {
        kind: kindOf(String(input.formSlug ?? ''), formTitle),
        formSlug: input.formSlug,
        formTitle,
        pagePath: input.pagePath,
        fields: input.fields,
        files: input.files,
        status: input.status === 'archived' ? 'archived' : 'new',
        notes: input.notes,
      },
    });
    return json(201, saved);
  } catch (err) {
    console.error('form intake failed:', err instanceof Error ? err.message : err);
    return json(502, { error: 'Could not store the submission' });
  }
}

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
  body: string | null;
}) {
  // The website's POST carries the intake secret, not a signed-in user.
  if (event.httpMethod === 'POST') {
    if (!intakeAllowed(event.headers)) return json(401, { error: 'Unauthorized' });
    return intake(event.body);
  }

  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  if (!pipelineConfigured()) return json(200, { configured: false });

  try {
    if (event.httpMethod === 'GET') {
      const query = event.queryStringParameters ?? {};
      const params = new URLSearchParams();
      for (const key of PASS_THROUGH) if (query[key]) params.set(key, query[key]);
      if (query.summary) {
        // "This month" in Colorado time, as the stored timestamps are UTC.
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: reportTimeZone() }).format(new Date());
        params.set('summary', '1');
        params.set('since', localMidnightUtc(monthBounds(today.slice(0, 7)).start));
      }
      const data = await pipeline<Record<string, unknown>>(`client-form-submissions${params.size ? `?${params}` : ''}`);
      return json(200, { configured: true, ...data });
    }

    if (event.httpMethod === 'PATCH' || event.httpMethod === 'DELETE') {
      let body: { id?: unknown; status?: unknown; notes?: unknown };
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return json(400, { error: 'Malformed request.' });
      }
      const data = await pipeline('client-form-submissions', {
        method: event.httpMethod,
        body: event.httpMethod === 'PATCH' ? { id: body.id, status: body.status, notes: body.notes } : { id: body.id },
      });
      return json(200, data);
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    console.error('form-submissions failed:', message);
    // The Pipeline's own 400/404 messages are written for the client; pass them on.
    const upstream = message.match(/returned (400|404): (.+)$/);
    if (upstream) return json(Number(upstream[1]), { error: upstream[2] });
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}
