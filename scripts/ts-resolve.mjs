/**
 * Let a check script import the app's modules the way the app writes them.
 *
 * `apps/web` is bundled by Next, so its imports are extensionless — `from
 * './latex-table'` — and aliased — `from '@/lib/queries'`. Node's own resolver
 * understands neither, so a module that imports another one cannot be loaded
 * by a plain `node --experimental-strip-types` script at all. The alternative
 * to this hook is either writing imports the app does not use, or testing
 * nothing that has a dependency, and neither is worth it.
 *
 * The alias half was added later and is what lets a script reach anything
 * above a leaf: almost every module in `lib/` imports at least one thing by
 * `@/`, so before it the only testable files were the pure ones. It is the
 * same mapping `tsconfig.json` gives Next — `@/*` is `apps/web/src/*` — stated
 * a second time here because Node cannot read that file's answer.
 *
 * Registered with `--import ./scripts/ts-resolve.mjs`.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * The repo root, resolved out here and baked into the hook as a literal.
 *
 * The hook body runs from a `data:` URL, where `import.meta.url` is the data
 * URL itself and relative resolution has nothing to hang off. Passing the
 * answer in is simpler than making the hook work it out, and it cannot drift.
 */
const ROOT = new URL('../', import.meta.url).href;

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs';
      import { fileURLToPath } from 'node:url';

      const SRC = new URL('apps/web/src/', ${JSON.stringify(ROOT)});

      export async function resolve(specifier, context, next) {
        // 'server-only' is a guard for the bundler, not a runtime dependency:
        // its package resolves to a file that throws unless React is doing the
        // importing, so in a plain script it takes down every server module —
        // which is all the ones worth checking. Answered with nothing, which
        // is what it compiles to on the server anyway.
        if (specifier === 'server-only' || specifier === 'client-only') {
          return { url: 'data:text/javascript,', shortCircuit: true };
        }

        // The app's own alias: '@/lib/x' is 'apps/web/src/lib/x'. Resolved to
        // an absolute file URL rather than a relative path, because the
        // importer can be anywhere in the tree.
        if (specifier.startsWith('@/')) {
          for (const ext of ['.ts', '.tsx', '/index.ts', '']) {
            const url = new URL(specifier.slice(2) + ext, SRC);
            if (existsSync(fileURLToPath(url))) return next(url.href, context);
          }
        }

        // Relative imports, which the app writes without an extension.
        //
        // The test is whether the file is *there*, not whether the specifier
        // looks extensionless. './queries.shared' ends in something that reads
        // as an extension and is not one, so a pattern match refused it and
        // that module could not be loaded at all.
        if (/^\\.{1,2}\\//.test(specifier)) {
          const asWritten = new URL(specifier, context.parentURL);
          if (!existsSync(fileURLToPath(asWritten))) {
            for (const ext of ['.ts', '.tsx', '/index.ts']) {
              const url = new URL(specifier + ext, context.parentURL);
              if (existsSync(fileURLToPath(url))) {
                return next(specifier + ext, context);
              }
            }
          }
        }

        return next(specifier, context);
      }
    `),
  pathToFileURL('./'),
);
