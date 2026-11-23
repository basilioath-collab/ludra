import { createHash, randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const {NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY} = process.env;
const [appUrl, name = 'Agenda de Ludra'] = process.argv.slice(2);
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !appUrl || !name.trim() || name.length > 80) {
  throw new Error('Forneça as variáveis do Supabase, o endereço do app e um nome de grupo válido.');
}
const app = new URL(appUrl);
if (app.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(app.hostname)) throw new Error('Use uma URL HTTPS.');
const db = createClient(NEXT_PUBLIC_SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const invite = randomBytes(32).toString('hex');
const admin = randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const file = '.env.group-links';
await writeFile(file, JSON.stringify({
  convite: app.origin + '/#join=' + invite,
  administracao: app.origin + '/#admin=' + admin,
},null,2) + '\n',{mode:0o600,flag:'wx'});
const {error} = await db.from('groups').insert({name:name.trim(),invite_hash:hash(invite),admin_hash:hash(admin)});
if (error) {
  await unlink(file);
  throw new Error('O banco não confirmou a criação do grupo. Verifique a conexão e as migrations.');
}
console.log('Grupo criado. Links gravados em .env.group-links com permissão restrita.');
