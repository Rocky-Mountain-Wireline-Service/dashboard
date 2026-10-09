// Applies db/*.sql to the database named in TURSO_CONFIG.
//   pnpm db:migrate
// Every statement is CREATE … IF NOT EXISTS, so running it again changes nothing.
import { readFileSync, readdirSync } from 'node:fs';
import { createClient } from '@libsql/client/web';

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
if (!databaseUrl || !authToken) {
  console.error('TURSO_CONFIG is not set in .env');
  process.exit(1);
}

const db = createClient({ url: databaseUrl, authToken });
const dir = new URL('../db/', import.meta.url);

for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const statements = readFileSync(new URL(file, dir), 'utf8')
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) {
    if (!/^CREATE (TABLE|INDEX) IF NOT EXISTS /i.test(sql)) {
      console.error(`Refusing to run a statement that is not an additive CREATE:\n${sql.slice(0, 80)}…`);
      process.exit(1);
    }
    await db.execute(sql);
  }
  console.log(`${file}: ${statements.length} statements applied`);
}
