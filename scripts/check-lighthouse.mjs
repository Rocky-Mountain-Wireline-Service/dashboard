// Runs the Lighthouse test now, as the scheduled check does on the 2nd.
//   pnpm lighthouse:check            print the result
//   pnpm lighthouse:check --write    and save it
import { createServer, loadEnv } from 'vite';

const write = process.argv.includes('--write');
Object.assign(process.env, loadEnv('development', process.cwd(), ''));
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const { tursoClient } = await vite.ssrLoadModule('/netlify/lib/turso.ts');
  const { lighthouseConfigured, lighthouseUrl, runLighthouse, saveLighthouse } = await vite.ssrLoadModule('/netlify/lib/lighthouse.ts');
  if (!lighthouseConfigured()) throw new Error('Set the Google service account (GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY) or PSI_API_KEY in .env');

  console.log(`Testing ${lighthouseUrl()} on mobile and desktop…`);
  const started = Date.now();
  const check = await runLighthouse();
  if (!check) throw new Error('Neither test finished; see the messages above.');
  console.log(`(${((Date.now() - started) / 1000).toFixed(1)}s)`);
  for (const result of [check.mobile, check.desktop].filter(Boolean)) {
    const { scores: s, metrics: m } = result;
    console.log(
      `${result.strategy.padEnd(8)} performance ${s.performance}, accessibility ${s.accessibility}, best practices ${s.bestPractices}, SEO ${s.seo}` +
        ` | LCP ${(m.lcp.value / 1000).toFixed(1)}s ${m.lcp.rating}, CLS ${m.cls.value} ${m.cls.rating}, TBT ${m.tbt.value}ms ${m.tbt.rating}`
    );
  }
  if (write) {
    const db = tursoClient();
    if (!db) throw new Error('TURSO_CONFIG is not set in .env');
    await saveLighthouse(db, check);
    console.log('Saved. The next report built for this month will include it.');
  }
} finally {
  await vite.close();
}
