/**
 * Let a check script import the app's modules the way the app writes them.
 *
 * `apps/web` is bundled by Next, so its imports are extensionless — `from
 * './latex-table'`. Node's own resolver requires the extension, so a module
 * that imports another one cannot be loaded by a plain `node --experimental-
 * strip-types` script at all. The alternative to this hook is either writing
 * imports the app does not use, or testing nothing that has a dependency, and
 * neither is worth it for eleven lines.
 *
 * Registered with `--import ./scripts/ts-resolve.mjs`.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      import { existsSync } from 'node:fs';
      import { fileURLToPath } from 'node:url';

      export async function resolve(specifier, context, next) {
        // Only relative imports with no extension, which is the app's style.
        if (/^\\.{1,2}\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) {
          for (const ext of ['.ts', '.tsx', '/index.ts']) {
            const url = new URL(specifier + ext, context.parentURL);
            if (existsSync(fileURLToPath(url))) {
              return next(specifier + ext, context);
            }
          }
        }

        return next(specifier, context);
      }
    `),
  pathToFileURL('./'),
);
