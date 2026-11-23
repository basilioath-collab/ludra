import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const ids = Array.from({length:8},(_,index)=>'00000000-0000-0000-0000-00000000000'+(index+1));
const [alice,bob,outsider,newDevice,group,otherGroup,guest,guestDevice] = ids;
const hash = seed => seed.repeat(64);
let character;
let windowId;
const start = new Date(Date.now()+3600000).toISOString();
const end = new Date(Date.now()+7200000).toISOString();
const profile = {nick:'Test',region:'SA',server:'Test',class_name:'Test'};

async function action(who,command,data) {
  const {rows} = await db.query('select public.party_action($1,$2,$3) as result',[who,command,JSON.stringify(data)]);
  return rows[0].result;
}
before(async()=>{
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key)');
  await db.exec(await readFile(new URL('../supabase/migrations/202611230001_party.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611230002_public_agenda.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611230003_raid_runs.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611230004_raid_portraits.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611230005_raid_party_names.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/202611230006_raid_run_name.sql',import.meta.url),'utf8'));
  for (const who of [alice,bob,outsider,newDevice]) await db.query('insert into auth.users values($1)',[who]);
  for (const [id,invite,admin] of [[group,'a','b'],[otherGroup,'c','d']]) {
    await db.query('insert into public.groups(id,name,invite_hash,admin_hash) values($1,$2,$3,$4)',[id,'Test group',hash(invite),hash(admin)]);
  }
  await db.query('update public.groups set public_access = true where id = $1',[group]);
  await db.exec('set role service_role');
});
after(async()=>{await db.close()});

test('membros veem agenda compartilhada e acessos alheios são rejeitados',async()=>{
  await action(alice,'join',{hash:hash('a')});
  await action(bob,'join',{hash:hash('a')});
  await action(outsider,'join',{hash:hash('c')});
  ({id:character}=await action(alice,'save_character',{group,...profile}));
  await assert.rejects(action(alice,'save_character',{group,...profile}),{code:'23505'});
  await action(alice,'save_windows',{group,character,windows:[{start,end}]});
  const bobCharacter = (await action(bob,'save_character',{group,...profile})).id;
  await action(bob,'save_windows',{group,character:bobCharacter,windows:[{start,end}]});
  const bobAgenda = await action(bob,'agenda',{group});
  assert.equal(bobAgenda.windows.length,2);
  assert.equal(bobAgenda.characters.length,2);
  windowId=bobAgenda.windows.find(row=>row.character_id===character).id;
  await assert.rejects(action(bob,'delete_window',{group,id:windowId}),{code:'42501'});
  await assert.rejects(action(bob,'save_character',{group,id:character,...profile}),{code:'42501'});
  await assert.rejects(action(bob,'save_windows',{group,character,windows:[{start,end}]}),{code:'42501'});
  await assert.rejects(action(outsider,'agenda',{group}),{code:'42501'});
  await assert.rejects(action(bob,'agenda',{group:otherGroup}),{code:'42501'});
});

test('acesso direto a tabelas e RPCs é recusado para anon e authenticated',async()=>{
  await db.exec('reset role');
  try {
    for (const role of ['anon','authenticated']) {
      await db.exec('set role '+role);
      for (const table of ['groups','characters','availability_windows','memberships','recovery_tokens','rate_limit_buckets']) {
        await assert.rejects(db.query('select * from public.'+table),{code:'42501'});
      }
      await assert.rejects(db.query('update public.availability_windows set note = $1 where id=$2',['x',windowId]),{code:'42501'});
      await assert.rejects(action(alice,'delete_window',{group,id:windowId}),{code:'42501'});
    }
  } finally { await db.exec('set role service_role'); }
});

test('recuperação rotaciona o segredo e revoga a identidade do aparelho antigo',async()=>{
  await action(alice,'issue_recovery',{group,replacement:hash('e')});
  await action(newDevice,'recover',{hash:hash('e'),replacement:hash('f')});
  await assert.rejects(action(alice,'agenda',{group}),{code:'42501'});
  await assert.rejects(action(outsider,'recover',{hash:hash('e'),replacement:hash('0')}),{code:'42501'});
  const agenda = await action(newDevice,'agenda',{group});
  assert.equal(agenda.characters.find(row=>row.id===character).member_id,agenda.mine);
  await action(newDevice,'delete_window',{group,id:windowId});
  assert.ok(!(await action(bob,'agenda',{group})).windows.some(row=>row.id===windowId));
});

test('admin é limitado ao seu grupo e convites antigos são revogados',async()=>{
  const rows = await action(outsider,'admin_list',{hash:hash('b')});
  assert.equal(rows.filter(row=>row.duplicate).length,2);
  await action(outsider,'admin_remove',{hash:hash('d'),id:character});
  assert.ok((await action(outsider,'admin_list',{hash:hash('b')})).some(row=>row.id===character));
  await assert.rejects(action(bob,'admin_list',{hash:hash('a')}),{code:'42501'});
  await action(outsider,'admin_revoke',{hash:hash('b')});
  await assert.rejects(action(outsider,'join',{hash:hash('a')}),{code:'42501'});
});

test('limite persistente bloqueia solicitações após a cota',async()=>{
  for (const expected of [true,true,false]) {
    assert.equal((await db.query('select public.party_limit($1,2) as ok',['test'])).rows[0].ok,expected);
  }
});

test('agenda pública usa identidade do navegador e recupera registros sem cadastro',async()=>{
  assert.deepEqual(await action(guest,'public_open',{}),{group});
  assert.deepEqual(await action(guest,'public_open',{}),{group});
  await assert.rejects(action(guest,'agenda',{group:otherGroup}),{code:'42501'});
  const {id}=await action(guest,'save_character',{group,...profile,nick:'Visitante'});
  await action(guest,'save_windows',{group,character:id,windows:[{start,end}]});
  await assert.rejects(action(bob,'delete_character',{group,id}),{code:'42501'});
  await action(guest,'issue_recovery',{group,replacement:hash('1')});
  await action(guestDevice,'recover',{hash:hash('1'),replacement:hash('2'),guest:true});
  await assert.rejects(action(guest,'agenda',{group}),{code:'42501'});
  const agenda=await action(guestDevice,'agenda',{group});
  assert.equal(agenda.characters.find(row=>row.id===id).member_id,agenda.mine);
  assert.ok(agenda.windows.some(row=>row.character_id===id));
});

test('runs independentes mantêm cinco vagas por PT e protegem a saída',async()=>{
  async function raid(who,command,data) {
    const {rows} = await db.query('select public.raid_action($1,$2,$3) as result',[who,command,JSON.stringify(data)]);
    return rows[0].result;
  }
  const visitors = Array.from({length:7},()=>crypto.randomUUID());
  for (const visitor of visitors) await action(visitor,'public_open',{});
  const booking = index=>({party:1,nick:'Raid '+index,server:'Teste',className:'Gladiator',characterKey:'char-'+index,cp:12000,gs:1600});
  const portrait = 'https://aion2.plaync.com/portrait.webp';
  const {id} = await raid(visitors[0],'raid_book',{...booking(0),startsAt:start,portrait,name:"Sentinelas"});
  for (let i=1;i<5;i++) await raid(visitors[i],'raid_book',{...booking(i),run:id});
  await assert.rejects(raid(visitors[5],'raid_book',{...booking(5),run:id}),/PT está cheia/);
  await assert.rejects(raid(visitors[5],'raid_book',{...booking(0),party:2,run:id}),{code:'23505'});
  await raid(visitors[5],'raid_book',{...booking(5),party:2,run:id});
  await assert.rejects(raid(visitors[6],'raid_leave',{run:id}),{code:'42501'});
  const other = await raid(visitors[6],'raid_book',{...booking(6),startsAt:start});
  assert.notEqual(other.id,id);
  const runs = await raid(visitors[0],'raid_list',{start:new Date(Date.now()).toISOString(),end});
  assert.equal(runs.length,2);
  assert.equal(runs.find(run=>run.id===id).slots.length,6);
  assert.equal(runs.find(run=>run.id===id).name,'Sentinelas');
  await assert.rejects(raid(visitors[6],'raid_rename',{run:id,name:'Outro'}),{code:'42501'});
  await raid(visitors[5],'raid_rename',{run:id,name:'Legião Abissal'});
  assert.equal(runs.find(run=>run.id===id).slots[0].portrait,portrait);
  assert.equal(runs.find(run=>run.id===id).slots[1].portrait,null);
  await raid(visitors[0],'raid_leave',{run:id});
  const updated = await raid(visitors[1],'raid_list',{start:new Date(Date.now()).toISOString(),end});
  assert.equal(updated.find(run=>run.id===id).slots.length,5);
  assert.equal(updated.find(run=>run.id===id).name,'Legião Abissal');
});
