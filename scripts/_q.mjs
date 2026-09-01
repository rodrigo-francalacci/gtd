import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
for (const line of readFileSync('C:/MyJavaScriptApps/gtd/apps/web/.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
}
const sql = neon(process.env.DATABASE_URL);
console.log('jobs:', await sql`select status, count(*)::int n from enrichment_jobs group by status`);
console.log('\njust read:');
console.log(await sql`select a.name, a.mime_type, length(a.ocr_text) chars, left(a.ocr_text, 90) sample
  from attachments a join enrichment_jobs j on j.attachment_id = a.id
  where j.status='done' and j.completed_at > now() - interval '10 minutes' limit 4`);
console.log('\nspend:', await sql`select purpose, count(*)::int calls, sum(input_tokens)::int inp, sum(output_tokens)::int outp
  from ai_spend where at > now() - interval '10 minutes' group by purpose`);
