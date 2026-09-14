import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/** The headless engine, shared verbatim with the CLIs. Never copied, never forked. */
const ENGINE_DIR = resolve(here, '..', 'tools', 'src');

/**
 * The engine is written for Node's ESM resolution, so its internal imports carry the `.js`
 * extension TypeScript wants (`./model.js` for `model.ts`). Vite does not follow that
 * convention, so it is translated here rather than by touching the engine, which must keep
 * running unchanged under `tsx` for the CLIs and the tests.
 */
function engineJsToTs(): Plugin {
  return {
    name: 'lototekno-engine-js-to-ts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer?.startsWith(ENGINE_DIR)) return null;
      if (!source.startsWith('.') || !source.endsWith('.js')) return null;
      const candidate = resolve(dirname(importer), `${source.slice(0, -3)}.ts`);
      return existsSync(candidate) ? candidate : null;
    },
  };
}

/**
 * The generated scenarios must not leave the machine they were generated on.
 *
 * They live in `public/fixtures/`, which Vite copies into `dist/` verbatim, so a production
 * build shipped 884 KB of invented volunteers to the real subdomain. Worse than the weight: the
 * plan picker offers to copy a scenario into the store whenever the store is empty AND the
 * fixtures answer, and that offer was documented as impossible in production precisely because
 * the fixtures were assumed not to be there. On a fresh database it would have offered to seed
 * a hundred and twenty imaginary people into the real project.
 *
 * Removed after the bundle is written rather than filtered on the way in, because `publicDir` is
 * a straight copy with no hook to filter. `npm run dev` serves `public/` directly and is
 * unaffected; `npm run preview`, which serves `dist/`, loses the fixture path, which is correct:
 * preview is meant to show what production will be.
 */
function dropFixtures(): Plugin {
  return {
    name: 'lototekno-drop-fixtures',
    apply: 'build',
    closeBundle() {
      const shipped = resolve(here, 'dist', 'fixtures');
      if (existsSync(shipped)) rmSync(shipped, { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [engineJsToTs(), react(), dropFixtures()],
  resolve: {
    alias: [{ find: /^@engine\//, replacement: `${ENGINE_DIR}/` }],
  },
  server: {
    // The engine lives outside the Vite root, one level up.
    fs: { allow: [resolve(here, '..')] },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
