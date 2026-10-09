import { json, requireUser } from '../lib/auth';
import { tursoClient } from '../lib/turso';
import config from '../../src/config/dashboard';

/**
 * The dashboard's inbox of website form submissions.
 *
 *   GET                         list, newest first (?kind=&status=&q=)
 *   GET    ?id=…                one submission, with its attachments listed
 *   GET    ?file=…              one attachment, as base64
 *   PATCH  { id, status?, notes? }
 *   DELETE { id }
 *
 * Every statement filters by this dashboard's own client ID. The table is
 * shared with other clients, and an ID in a request proves nothing about whose
 * row it is.
 */

const CLIENT = config.clientId;
const STATUSES = ['new', 'in_progress', 'done', 'archived'];
const KINDS = ['contact', 'application', 'other'];
const MAX_NOTES = 5000;
const LIST_LIMIT = 300;

interface Field {
  label: string;
  name: string;
  value: string;
}

const parseFields = (raw: unknown): Field[] => {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** The stored timestamp is UTC without a zone; say so, or browsers read it as local. */
const iso = (value: unknown) => `${String(value).replace(' ', 'T')}Z`;

export async function handler(event: {
  httpMethod: string;
  headers: Record<string, string>;
  queryStringParameters: Record<string, string> | null;
  body: string | null;
}) {
  const auth = await requireUser(event.headers);
  if ('response' in auth) return auth.response;

  const db = tursoClient();
  if (!db) return json(200, { configured: false });

  const query = event.queryStringParameters ?? {};

  try {
    if (event.httpMethod === 'GET' && query.file) {
      const row = (
        await db.execute({
          sql: `SELECT filename, content_type, content FROM form_submission_files
                 WHERE id = ? AND client_id = ?`,
          args: [query.file, CLIENT],
        })
      ).rows[0];
      if (!row) return json(404, { error: 'That file no longer exists.' });
      return json(200, {
        filename: row.filename,
        contentType: row.content_type || 'application/octet-stream',
        content: Buffer.from(row.content as ArrayBuffer).toString('base64'),
      });
    }

    if (event.httpMethod === 'GET' && query.id) {
      const [submission, files] = await Promise.all([
        db.execute({
          sql: `SELECT id, kind, form_title, name, email, phone, fields, page_path, status, notes, created_at, updated_at
                  FROM form_submissions WHERE id = ? AND client_id = ?`,
          args: [query.id, CLIENT],
        }),
        db.execute({
          sql: `SELECT id, filename, content_type, size FROM form_submission_files
                 WHERE submission_id = ? AND client_id = ? ORDER BY created_at`,
          args: [query.id, CLIENT],
        }),
      ]);
      const row = submission.rows[0];
      if (!row) return json(404, { error: 'That submission no longer exists.' });
      return json(200, {
        configured: true,
        submission: {
          id: row.id,
          kind: row.kind,
          formTitle: row.form_title,
          name: row.name,
          email: row.email,
          phone: row.phone,
          fields: parseFields(row.fields),
          pagePath: row.page_path,
          status: row.status,
          notes: row.notes ?? '',
          createdAt: iso(row.created_at),
          updatedAt: iso(row.updated_at),
          files: files.rows.map((f) => ({
            id: f.id,
            filename: f.filename,
            contentType: f.content_type,
            size: Number(f.size) || 0,
          })),
        },
      });
    }

    if (event.httpMethod === 'GET') {
      const where = ['s.client_id = ?'];
      const args: (string | number)[] = [CLIENT];

      if (KINDS.includes(query.kind)) {
        where.push('s.kind = ?');
        args.push(query.kind);
      }
      if (STATUSES.includes(query.status)) {
        where.push('s.status = ?');
        args.push(query.status);
      } else if (query.status !== 'all') {
        // Archived items are out of the way unless asked for.
        where.push("s.status != 'archived'");
      }
      const q = (query.q ?? '').trim().slice(0, 100);
      if (q) {
        // The fields column is searched too, so a word from the message or a
        // position applied for finds the submission, not only a name.
        where.push(
          `(s.name LIKE ? ESCAPE '\\' OR s.email LIKE ? ESCAPE '\\' OR s.phone LIKE ? ESCAPE '\\' OR s.fields LIKE ? ESCAPE '\\')`
        );
        const like = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
        args.push(like, like, like, like);
      }

      const [rows, counts] = await Promise.all([
        db.execute({
          sql: `SELECT s.id, s.kind, s.form_title, s.name, s.email, s.phone, s.fields, s.status, s.notes, s.created_at,
                       (SELECT COUNT(*) FROM form_submission_files f WHERE f.submission_id = s.id) AS file_count
                  FROM form_submissions s
                 WHERE ${where.join(' AND ')}
                 ORDER BY s.created_at DESC
                 LIMIT ${LIST_LIMIT}`,
          args,
        }),
        db.execute({
          sql: `SELECT kind, status, COUNT(*) AS n FROM form_submissions
                 WHERE client_id = ? GROUP BY kind, status`,
          args: [CLIENT],
        }),
      ]);

      return json(200, {
        configured: true,
        submissions: rows.rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          formTitle: row.form_title,
          name: row.name,
          email: row.email,
          phone: row.phone,
          fields: parseFields(row.fields),
          status: row.status,
          notes: row.notes ?? '',
          createdAt: iso(row.created_at),
          fileCount: Number(row.file_count) || 0,
        })),
        counts: counts.rows.map((r) => ({ kind: r.kind, status: r.status, n: Number(r.n) || 0 })),
      });
    }

    let body: { id?: string; status?: string; notes?: string } = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'Malformed request.' });
    }
    if (!body.id) return json(400, { error: 'Missing id.' });

    if (event.httpMethod === 'PATCH') {
      const sets: string[] = [];
      const args: (string | number)[] = [];
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return json(400, { error: 'Unknown status.' });
        sets.push('status = ?');
        args.push(body.status);
      }
      if (body.notes !== undefined) {
        sets.push('notes = ?');
        args.push(String(body.notes).slice(0, MAX_NOTES));
      }
      if (!sets.length) return json(400, { error: 'Nothing to change.' });

      const result = await db.execute({
        sql: `UPDATE form_submissions SET ${sets.join(', ')}, updated_at = datetime('now')
               WHERE id = ? AND client_id = ?`,
        args: [...args, body.id, CLIENT],
      });
      if (!result.rowsAffected) return json(404, { error: 'That submission no longer exists.' });
      return json(200, { success: true });
    }

    if (event.httpMethod === 'DELETE') {
      // Files first, explicitly: the cascade only fires where foreign keys are
      // switched on for the connection, which is not something to rely on.
      const results = await db.batch(
        [
          {
            sql: 'DELETE FROM form_submission_files WHERE submission_id = ? AND client_id = ?',
            args: [body.id, CLIENT],
          },
          { sql: 'DELETE FROM form_submissions WHERE id = ? AND client_id = ?', args: [body.id, CLIENT] },
        ],
        'write'
      );
      if (!results[1].rowsAffected) return json(404, { error: 'That submission no longer exists.' });
      return json(200, { success: true });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('form-submissions failed:', err instanceof Error ? err.message : err);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}
