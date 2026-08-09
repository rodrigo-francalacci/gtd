import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Single source of truth for env: the web app's .env.local, which is also
// the shape Vercel injects in deployed environments.
config({ path: '../../apps/web/.env.local' });

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
