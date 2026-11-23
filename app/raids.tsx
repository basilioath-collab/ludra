'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { dateKey } from '../lib/agenda';
import type { ArmoryProfile, CharacterMatch } from '../lib/armory';
import Party from './party';

type Slot = {party:1|2;slot:number;nick:string;className:string;server:string;cp:number|null;gs:number|null;mine:boolean};
type Run = {id:string;startsAt:string;slots:Slot[]};
const parties = [1,2] as const;
const number = new Intl.NumberFormat('pt-BR');
const dayLabel = new Intl.DateTimeFormat('pt-BR',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
const clock = new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'});

async function action<T>(action:string, fields:Record<string,unknown> = {}):Promise<T> {
  const response = await fetch('/api/party',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...fields})});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function Stats({cp,gs}:{cp:number|null;gs:number|null}) {
  return <span className="raid-stats"><span><b>{cp===null?'—':number.format(cp)}</b> CP</span>
    <span><b>{gs===null?'—':number.format(gs)}</b> GS</span></span>;
}

export default function Raids() {
  const [legacy,setLegacy] = useState(false);
  const [ready,setReady] = useState(false);
  const [nick,setNick] = useState('');
  const [region,setRegion] = useState('la');
  const [matches,setMatches] = useState<CharacterMatch[]>([]);
  const [character,setCharacter] = useState<ArmoryProfile>();
  const [today,setToday] = useState('');
  const [day,setDay] = useState('');
  const [starts,setStarts] = useState('20:00');
  const [party,setParty] = useState<1|2>(1);
  const [runs,setRuns] = useState<Run[]>([]);
  const [loading,setLoading] = useState(false);
  const [busy,setBusy] = useState(false);
  const [lookupError,setLookupError] = useState('');
  const [scheduleError,setScheduleError] = useState('');
  const [success,setSuccess] = useState('');
  const dates = today ? Array.from({length:14},(_,index)=>new Date(Date.parse(today+'T12:00:00Z')+index*86400000).toISOString().slice(0,10)) : [];
  const visibleRuns = runs.filter(run=>dateKey(new Date(run.startsAt))===day);

  useEffect(()=>{
    if (/^#(?:join|recover|admin)=/.test(location.hash)) {setLegacy(true);return;}
    const today = dateKey(new Date());
    setToday(today);setDay(today);
    void action('public_open').then(()=>setReady(true)).catch(cause=>setScheduleError(cause.message));
  },[]);
  useEffect(()=>{
    if (!ready || !day) return;
    let active = true;
    void action<Run[]>('raid_list',{day}).then(result=>{if (active) {setRuns(result);setScheduleError('');}})
      .catch(cause=>{if (active) setScheduleError(cause.message);});
    return ()=>{active=false;};
  },[ready,day]);

  async function lookup(event:FormEvent) {
    event.preventDefault();
    if (!nick.trim()) return;
    setLoading(true);setLookupError('');setCharacter(undefined);setMatches([]);
    try {
      const result = await action<CharacterMatch[]>('armory_search',{nick:nick.trim(),region});
      const exact = result.filter(match=>match.nick.toLowerCase()===nick.trim().toLowerCase());
      const candidates = exact.length ? exact : result;
      if (candidates.length === 1) setCharacter(await action<ArmoryProfile>('armory_profile',{character:candidates[0]}));
      else if (candidates.length) setMatches(candidates);
      else setLookupError('Nenhum personagem encontrado nessa região.');
    } catch (cause) {setLookupError((cause as Error).message);}
    finally {setLoading(false);}
  }

  async function select(match:CharacterMatch) {
    setLoading(true);setLookupError('');
    try {setCharacter(await action<ArmoryProfile>('armory_profile',{character:match}));setMatches([]);}
    catch (cause) {setLookupError((cause as Error).message);}
    finally {setLoading(false);}
  }

  async function update(operation:'raid_book'|'raid_leave',run?:string,team:1|2=party) {
    if (operation==='raid_book' && !character) {document.getElementById('raid-nick')?.focus();setLookupError('Pesquise seu personagem para reservar uma vaga.');return;}
    setBusy(true);setScheduleError('');setSuccess('');
    try {
      await action(operation,{run,day,time:starts,party:team,character});
      setRuns(await action<Run[]>('raid_list',{day}));
      setSuccess(operation==='raid_book'?'Vaga confirmada.':'Vaga liberada.');
    } catch (cause) {setScheduleError((cause as Error).message);}
    finally {setBusy(false);}
  }

  if (legacy) return <Party />;

  return <main className="raid-shell">
    <header className="raid-header"><a href="/">LUDRA <b>PARTY</b></a><span>AION 2 · AGENDA DE RUNS</span></header>
    <section className="raid-hero">
      <div><p className="raid-kicker">ABYSSALFORGE</p><h1>Ludra <em>Party</em></h1>
      <p>Duas PTs. Dez vagas. Escolha sua próxima run.</p></div>
    </section>

    <section className="raid-console" aria-label="Pesquisar personagem">
      <form onSubmit={lookup} className="raid-search">
        <label>Pesquisar personagem<input id="raid-nick" value={nick} maxLength={40} placeholder="Digite seu nick no jogo" required disabled={loading}
          onChange={event=>{setNick(event.target.value);setCharacter(undefined);setMatches([]);setLookupError('');}} /></label>
        <label>Região<select value={region} disabled={loading} onChange={event=>{setRegion(event.target.value);setCharacter(undefined);setMatches([]);}}>
          <option value="la">América do Sul</option><option value="nae">América do Norte · Leste</option>
          <option value="naw">América do Norte · Oeste</option><option value="eu">Europa</option><option value="as">Ásia</option>
        </select></label>
        <button className="raid-primary" disabled={!ready||loading}>{loading?'Buscando…':'Pesquisar'}</button>
      </form>
      {lookupError && <p role="alert" className="raid-error">{lookupError}</p>}
      {matches.length>0 && <div className="raid-matches">{matches.map(match=><button key={match.serverId+'/'+match.id} disabled={loading}
        onClick={()=>void select(match)}>{match.nick}<small>{match.server}</small></button>)}</div>}
      {character && <div className="raid-character"><div><strong>{character.nick}</strong><small>{character.className} · {character.server}</small></div>
        <Stats cp={character.cp} gs={character.gs}/></div>}
    </section>

    <section className="raid-board" aria-label="Runs do dia">
      <div className="raid-title"><div><p className="raid-kicker">AGENDA · HORÁRIO DE BRASÍLIA</p><h2>Próximas runs</h2></div>
        <label>Dia<input type="date" min={today} max={dates.at(-1)} value={day} disabled={busy}
          onChange={event=>{if(event.target.value) {setDay(event.target.value);setSuccess('');}}}/></label></div>
      {scheduleError && <p className="raid-error" role="alert">{scheduleError}</p>}
      {success && <p className="raid-success" role="status">{success}</p>}
      <form className="raid-create" onSubmit={event=>{event.preventDefault();void update('raid_book');}}>
        <label>Horário da nova run<input type="time" value={starts} required onChange={event=>setStarts(event.target.value)}/></label>
        <label>Minha PT<select value={party} onChange={event=>setParty(event.target.value==='2'?2:1)}><option value={1}>PT1</option><option value={2}>PT2</option></select></label>
        <button className="raid-primary" disabled={!ready||busy}>Criar run e entrar</button>
      </form>
      {ready && !visibleRuns.length && <p className="raid-empty">Nenhuma run marcada{day?' · '+dayLabel.format(new Date(day+'T12:00:00Z')):''}</p>}
      {visibleRuns.map(run=><article className="raid-card" key={run.id}>
        <div className="raid-card-head"><h3>{clock.format(new Date(run.startsAt))}</h3><span>{run.slots.length} / 10 vagas</span></div>
        <div className="raid-parties">{parties.map(team=>{
          const slots=run.slots.filter(slot=>slot.party===team);
          const mine=run.slots.find(slot=>slot.mine);
          return <section className="raid-party" key={team}>
            <h4>PT{team}<span>{slots.length}/5</span></h4>
            <ol>{Array.from({length:5},(_,index)=>{
              const slot=slots.find(slot=>slot.slot===index+1);
              return <li key={index}>{slot?<><div><strong>{slot.nick}</strong><small>{slot.className} · {slot.server}</small></div><Stats cp={slot.cp} gs={slot.gs}/></>:<span>Vaga livre</span>}</li>;
            })}</ol>
            {mine?.party===team ? <button disabled={busy} onClick={()=>void update('raid_leave',run.id)}>Sair da PT{team}</button> :
              <button disabled={busy||slots.length===5||!!mine||Date.parse(run.startsAt)<=Date.now()}
                onClick={()=>void update('raid_book',run.id,team)}>Entrar na PT{team}</button>}
          </section>;
        })}</div>
      </article>)}
    </section>
  </main>;
}
