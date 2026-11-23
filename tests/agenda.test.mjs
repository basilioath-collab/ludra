import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaps, dayBounds, dateKey } from '../lib/agenda.ts';

const row = (person, character, start, end) => ({
  member_id:person,character_id:character,
  starts_at:new Date(start).toISOString(),ends_at:new Date(end).toISOString(),
});
test('intervalos adjacentes não coincidem',()=>{
  assert.deepEqual(overlaps([row('p1','c1',0,10),row('p2','c2',10,20)],0,20),[]);
});
test('sobreposição real conta alts como personagens e uma única pessoa',()=>{
  const rows = [row('p1','c1',0,20),row('p1','c2',5,20),row('p2','c3',10,30)];
  const result = overlaps(rows,0,30);
  assert.deepEqual(result.map(({start,end,people,characters})=>[start,end,people,characters.length]),[[10,20,2,3]]);
  assert.deepEqual(overlaps(rows.slice(0,2),0,30),[]);
});
test('um dia da agenda começa à meia-noite em São Paulo',()=>{
  const [start,end] = dayBounds('2026-11-23');
  assert.equal(new Date(start).toISOString(),'2026-11-23T03:00:00.000Z');
  assert.equal(dateKey(new Date(start-1)),'2026-11-22');
  assert.equal(end-start,86400000);
});
