import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

function createClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Locally: copy apps/web/.env.example to ' +
        'apps/web/.env.local and fill in your Neon connection string. ' +
        'On Vercel: add it under Settings → Environment Variables, or link ' +
        'the Neon integration so it is injected per environment.',
    );
  }

  return drizzle(neon(connectionString), { schema });
}

type DbClient = ReturnType<typeof createClient>;

let cached: DbClient | undefined;

function getClient(): DbClient {
  cached ??= createClient();
  return cached;
}

/**
 * The database handle, connected lazily on first use.
 *
 * Deliberately not built at module load. `next build` evaluates route modules
 * to collect page data, which imports this file — so throwing at module
 * evaluation made the build itself require a live connection string, and it
 * failed on Vercel before a single request had been served. Every route is
 * `force-dynamic`, so nothing genuinely needs the database until a request
 * arrives; the error should surface then, not at build time.
 *
 * The Proxy keeps `db.select()` and friends reading exactly as before.
 */
export const db = new Proxy({} as DbClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export type Db = DbClient;
