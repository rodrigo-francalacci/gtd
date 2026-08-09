import { config } from 'dotenv';

// Must be imported before anything that reads process.env.DATABASE_URL.
// ESM evaluates imported modules in declaration order, so `import './env'`
// placed first in a file is guaranteed to run before later imports.
config({ path: new URL('../../../apps/web/.env.local', import.meta.url) });
