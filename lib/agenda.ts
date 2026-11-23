export type Character = {
  id:string; member_id:string; nick:string; class_name:string; region:string; server:string;
  level:number|null; cp:number|null; gs:number|null; faction:string|null; legion:string|null; updated_at:string;
};
export type Window = {
  id:string; member_id:string; character_id:string; starts_at:string; ends_at:string;
  role_name:string|null; note:string|null;
};
export type Agenda = {name:string; mine:string; characters:Character[]; windows:Window[]};
export const zone = 'America/Sao_Paulo';
export const dateKey = (date:Date) => new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(date);
export const time = (instant:string|number) => new Intl.DateTimeFormat('pt-BR',{timeZone:zone,hour:'2-digit',minute:'2-digit'}).format(new Date(instant));

export function dayBounds(day:string) {
  const start = +new Date(day + 'T00:00:00-03:00');
  return [start,start + 86400000] as const;
}

export function overlaps(windows:Window[], start:number, end:number) {
  const clipped = windows.map(window=>({...window,
    start:Math.max(start,Date.parse(window.starts_at)),end:Math.min(end,Date.parse(window.ends_at)),
  })).filter(window=>window.start < window.end);
  const edges = [...new Set(clipped.flatMap(window=>[window.start,window.end]))].sort((a,b)=>a-b);
  const result:{start:number;end:number;people:number;characters:string[];members:string[]}[] = [];
  for (let index=0; index < edges.length-1; index++) {
    const from=edges[index], to=edges[index+1];
    const active=clipped.filter(window=>window.start <= from && window.end >= to);
    const members=[...new Set(active.map(window=>window.member_id))].sort();
    if (members.length < 2) continue;
    const characters=[...new Set(active.map(window=>window.character_id))].sort();
    const prior=result.at(-1);
    if (prior?.end === from && prior.members.join() === members.join() && prior.characters.join() === characters.join()) {
      prior.end=to;
    } else {
      result.push({start:from,end:to,people:members.length,characters,members});
    }
  }
  return result;
}
