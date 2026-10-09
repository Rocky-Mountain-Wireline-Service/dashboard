import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';

/**
 * Runs the Netlify functions inside `pnpm dev`.
 *
 * Vite on its own knows nothing about `/.netlify/functions/*`, so every data
 * call fell through to the app's own index.html — a 200 full of HTML where JSON
 * was expected. `netlify dev` solves that too, but moves the app to another
 * port, which then has to be added to Auth0 as a second callback address.
 *
 * Development only: on Netlify the functions are deployed as functions.
 */
export function devFunctions(): Plugin {
  return {
    name: 'rmws:dev-functions',
    apply: 'serve',
    configureServer(server) {
      // The functions read process.env, as they do on Netlify. An empty prefix
      // loads every variable in .env, not only the VITE_ ones meant for the browser.
      //
      // Vite restarts in the same process when .env is edited, and loadEnv lets
      // anything already in process.env win. Without clearing what the previous
      // run injected, an edited value would never take effect until a manual
      // restart — so those keys are remembered and removed first.
      const store = globalThis as { __rmwsInjectedEnv?: Set<string> };
      for (const key of store.__rmwsInjectedEnv ?? []) delete process.env[key];
      const injected = (store.__rmwsInjectedEnv = new Set<string>());

      const env = loadEnv(server.config.mode, server.config.root, '');
      for (const [key, value] of Object.entries(env)) {
        if (key in process.env) continue;
        process.env[key] = value;
        injected.add(key);
      }

      server.middlewares.use('/.netlify/functions', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const name = url.pathname.replace(/^\/+|\/+$/g, '');
        const file = resolve(server.config.root, 'netlify/functions', `${name}.ts`);

        const send = (status: number, headers: Record<string, string>, body: string) => {
          res.writeHead(status, headers);
          res.end(body);
        };

        if (!/^[\w-]+$/.test(name) || !existsSync(file)) {
          return send(404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: `No function named "${name}"` }));
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);

        try {
          // Loaded through Vite so an edit to a function takes effect on the
          // next request, without restarting the server.
          const mod = await server.ssrLoadModule(file);
          const result = await mod.handler({
            httpMethod: req.method ?? 'GET',
            headers: Object.fromEntries(
              Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])
            ),
            queryStringParameters: Object.fromEntries(url.searchParams),
            body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null,
          });
          send(result.statusCode ?? 200, result.headers ?? {}, result.body ?? '');
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          console.error(`[functions] ${name} failed:`, err);
          send(500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'Function crashed. See the terminal.' }));
        }
      });
    },
  };
}
