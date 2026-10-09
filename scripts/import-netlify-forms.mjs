// Backfills the Form Submissions inbox from Netlify Forms CSV exports.
//
//   node scripts/import-netlify-forms.mjs <folder>           dry run
//   node scripts/import-netlify-forms.mjs <folder> --write   apply
//
// Safe to run again: every row gets an ID derived from its own content, so a
// second run inserts nothing it has already inserted. Attachments are fetched
// from the links in the export and stored with the submission, because those
// links stop working when the old Netlify site is retired.
//
// Left out on purpose: the IP address and browser string Netlify recorded, and
// anything that filled the hidden spam-trap field.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@libsql/client/web';

const [folder, ...flags] = process.argv.slice(2);
const WRITE = flags.includes('--write');
if (!folder) {
  console.error('Usage: node scripts/import-netlify-forms.mjs <folder> [--write]');
  process.exit(1);
}

/** Submissions newer than this arrive as New; older ones were dealt with by email long ago. */
const NEW_WITHIN_DAYS = 30;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Labels match the rebuilt site's forms, so old and new rows share columns in an export.
const APPLICATION_FIELDS = [
  ['branch', 'Which branch are you applying to?'],
  ['firstname', 'First Name'],
  ['lastname', 'Last Name'],
  ['email', 'Email'],
  ['phone', 'Mobile Phone'],
  ['homephone', 'Home Phone'],
  ['position', 'Position Applied For'],
  ['city', 'City'],
  ['state', 'State'],
  ['zip', 'ZIP Code'],
  ['haveExperience', 'Do you have wireline experience?'],
  ['message', 'Anything else we should know?'],
];
const CONTACT_FIELDS = [
  ['fullname', 'Full Name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['message', 'Message'],
];

// ── .env ────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z]/.test(line))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')];
    })
);
const { databaseUrl, authToken } = JSON.parse(env.TURSO_CONFIG || '{}');
const clientId = (
  readFileSync(new URL('../src/config/dashboard.ts', import.meta.url), 'utf8').match(/"clientId":\s*"([^"]+)"/) || []
)[1];
if (!databaseUrl || !authToken || !clientId) {
  console.error('TURSO_CONFIG or the dashboard clientId is missing.');
  process.exit(1);
}

// ── CSV (quoted fields may contain commas, quotes and line breaks) ──────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const clean = (value) => String(value ?? '').replace(/\r\n/g, '\n').trim();
const sha = (text) => createHash('sha1').update(text).digest('hex').slice(0, 32);
const cutoff = Date.now() - NEW_WITHIN_DAYS * 86_400_000;

// ── Read ────────────────────────────────────────────────────────────────────
const submissions = [];
const skipped = { spamTrap: 0, empty: 0 };

for (const file of readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.csv')).sort()) {
  const rows = parseCsv(readFileSync(join(folder, file), 'utf8').replace(/^﻿/, ''));
  const isContact = 'fullname' in (rows[0] ?? {});
  const map = isContact ? CONTACT_FIELDS : APPLICATION_FIELDS;
  let kept = 0;

  for (const row of rows) {
    // `website` is the hidden field only a bot fills in.
    if (clean(row.website)) { skipped.spamTrap++; continue; }

    const fields = map
      .map(([name, label]) => ({ label, name, value: clean(row[name]).slice(0, 10_000) }))
      .filter((f) => f.value);
    const name = isContact ? clean(row.fullname) : [clean(row.firstname), clean(row.lastname)].filter(Boolean).join(' ');
    const email = clean(row.email);
    if (!name && !email && !clean(row.message)) { skipped.empty++; continue; }

    const created = new Date(row.created_at);
    let upload = null;
    try {
      const parsed = JSON.parse(row.upload || 'null');
      if (parsed?.url && parsed?.filename) upload = parsed;
    } catch {
      // No usable attachment on this row.
    }

    let pagePath = null;
    try { pagePath = new URL(row.referrer).pathname.replace(/(.)\/$/, '$1'); } catch { /* no referrer */ }

    submissions.push({
      id: sha(`netlify|${file}|${row.created_at}|${email}|${name}`),
      kind: isContact ? 'contact' : 'application',
      formSlug: `netlify-import:${file.replace(/\.csv$/i, '')}`,
      formTitle: isContact ? 'Sales Inquiry' : 'Employment Application',
      name: name || null,
      email: email || null,
      phone: clean(row.phone) || null,
      fields,
      pagePath,
      status: created.getTime() >= cutoff ? 'new' : 'done',
      createdAt: created.toISOString().slice(0, 19).replace('T', ' '),
      upload,
    });
    kept++;
  }
  console.log(`${file}: ${rows.length} rows, ${kept} to import`);
}

const withFiles = submissions.filter((s) => s.upload);
const count = (pred) => submissions.filter(pred).length;
console.log(
  `\n${submissions.length} submissions: ${count((s) => s.kind === 'application')} job applications, ` +
    `${count((s) => s.kind === 'contact')} sales contacts; ${count((s) => s.status === 'new')} marked New ` +
    `(last ${NEW_WITHIN_DAYS} days), the rest Done.`
);
console.log(`${withFiles.length} attachments to fetch. Skipped: ${skipped.spamTrap} spam-trap, ${skipped.empty} empty.`);

if (!WRITE) {
  console.log('\nDry run. Nothing written. Add --write to apply.');
  process.exit(0);
}

// ── Write ───────────────────────────────────────────────────────────────────
const db = createClient({ url: databaseUrl, authToken });
let inserted = 0;

for (let i = 0; i < submissions.length; i += 50) {
  const results = await db.batch(
    submissions.slice(i, i + 50).map((s) => ({
      sql: `INSERT OR IGNORE INTO form_submissions
              (id, client_id, kind, form_slug, form_title, name, email, phone, fields, page_path, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [s.id, clientId, s.kind, s.formSlug, s.formTitle, s.name, s.email, s.phone,
             JSON.stringify(s.fields), s.pagePath, s.status, s.createdAt, s.createdAt],
    })),
    'write'
  );
  inserted += results.reduce((sum, r) => sum + r.rowsAffected, 0);
  process.stdout.write(`\rsubmissions: ${Math.min(i + 50, submissions.length)}/${submissions.length}`);
}
console.log(`\ninserted ${inserted} new submissions (${submissions.length - inserted} were already there)`);

// Attachments: a few at a time, and only those not stored by an earlier run.
const have = new Set(
  (await db.execute({ sql: 'SELECT id FROM form_submission_files WHERE client_id = ?', args: [clientId] })).rows.map((r) => r.id)
);
const files = { stored: 0, already: 0, failed: [] };
const queue = withFiles.slice();

async function worker() {
  for (let s = queue.shift(); s; s = queue.shift()) {
    const fileId = sha(`file|${s.id}`);
    if (have.has(fileId)) { files.already++; continue; }
    try {
      const res = await fetch(s.upload.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error(`size ${bytes.length}`);
      await db.execute({
        sql: `INSERT OR IGNORE INTO form_submission_files
                (id, submission_id, client_id, filename, content_type, size, content, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [fileId, s.id, clientId, String(s.upload.filename).slice(0, 200),
               res.headers.get('content-type'), bytes.length, bytes, s.createdAt],
      });
      files.stored++;
    } catch (err) {
      files.failed.push(`${s.createdAt.slice(0, 10)} ${s.id.slice(0, 8)}: ${err.message}`);
    }
    process.stdout.write(`\rattachments: ${files.stored + files.already + files.failed.length}/${withFiles.length}`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

console.log(`\nstored ${files.stored} attachments (${files.already} already there, ${files.failed.length} failed)`);
if (files.failed.length) console.log(files.failed.map((f) => `  ${f}`).join('\n'));
