'use client';

import Script from 'next/script';
import { createClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { dateKey, dayBounds, overlaps, time, type Agenda, type Character, type Window } from '../lib/agenda';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = url && key ? createClient(url,key,{auth:{detectSessionInUrl:false}}) : null;
const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const local = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_LOCAL_NO_CAPTCHA === '1' &&
  !!url && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url);

type Challenge = {render:(selector:string,options:Record<string,unknown>)=>string; reset:(id?:string)=>void};
type AuthWindow = Window & {turnstile?:Challenge};
type LinkKind = 'join'|'recover'|'admin';
type AdminCharacter = {id:string;nick:string;region:string;server:string;duplicate:boolean};
const baseCharacter = {id:null as string|null,nick:'',region:'',server:'',class_name:'',level:'',cp:'',gs:'',faction:'',legion:''};
const profileFields = [
  ['nick','Nick',40,true],['region','Região',24,true],['server','Servidor',40,true],
  ['class_name','Classe',40,true],['level','Nível',3,false],['cp','CP informado',10,false],
  ['gs','GS / item level informado',10,false],['faction','Facção',40,false],['legion','Legion',60,false],
] as const;

function nextDate(day:string,index:number) {
  return new Date(Date.parse(day + 'T12:00:00Z') + index * 86400000).toISOString().slice(0,10);
}

async function api<T>(action:string,payload:Record<string,unknown> = {}) {
  const session = (await supabase?.auth.getSession())?.data.session;
  if (!session) throw new Error('Abra o convite do grupo para continuar.');
  const response = await fetch('/api/party',{method:'POST',headers:{
    'Content-Type':'application/json', Authorization:'Bearer ' + session.access_token,
  }, body:JSON.stringify({action,...payload})});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result as T;
}

function initials(nick:string) { return [...nick.trim()].slice(0,2).join('').toUpperCase(); }
function prettyDay(day:string, options:Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',...options}).format(new Date(day+'T12:00:00Z'));
}
function makeLink(kind:LinkKind,token:string) {
  return location.origin + '/#' + kind + '=' + token;
}

export default function Party() {
  const initialized = useRef(false);
  const [pending,setPending] = useState<{kind:LinkKind;token:string}|null>(null);
  const [ready,setReady] = useState(false);
  const [signed,setSigned] = useState(false);
  const [captcha,setCaptcha] = useState('');
  const [challenge,setChallenge] = useState(false);
  const [group,setGroup] = useState('');
  const [agenda,setAgenda] = useState<Agenda|null>(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [day,setDay] = useState('');
  const [selectedDays,setSelectedDays] = useState<string[]>([]);
  const [start,setStart] = useState('20:00');
  const [end,setEnd] = useState('22:00');
  const [overnight,setOvernight] = useState(false);
  const [role,setRole] = useState('');
  const [note,setNote] = useState('');
  const [choice,setChoice] = useState('');
  const [windowId,setWindowId] = useState<string|null>(null);
  const [profile,setProfile] = useState(baseCharacter);
  const [showProfile,setShowProfile] = useState(false);
  const [share,setShare] = useState('');
  const [admin,setAdmin] = useState('');
  const [adminRows,setAdminRows] = useState<AdminCharacter[]>([]);
  const [tab,setTab] = useState<'agenda'|'registro'>('agenda');

  useEffect(()=>{
    if (initialized.current) return;
    initialized.current = true;
    const params = new URLSearchParams(location.hash.slice(1));
    const kind = (['join','recover','admin'] as const).find(value=>params.has(value));
    if (location.hash) history.replaceState(null,'',location.pathname + location.search);
    const today = dateKey(new Date());
    setDay(today);
    setSelectedDays([today]);
    const token = kind && params.get(kind);
    if (kind && token) setPending({kind,token});
    void (async()=>{
      try {
        const hasSession = !!(await supabase?.auth.getSession())?.data.session;
        setSigned(hasSession);
        const saved = localStorage.getItem('ludra-last-group');
        if (!kind && hasSession && saved) {
          setGroup(saved);
          setAgenda(await api<Agenda>('agenda',{group:saved}));
        }
      } catch (cause) { setError((cause as Error).message); }
      finally {setReady(true);}
    })();
  },[]);

  async function run(work:()=>Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try {await work();}
    catch(cause) {setError((cause as Error).message);}
    finally {setBusy(false);}
  }

  async function enter() {
    if (!pending || !supabase) return;
    await run(async()=>{
      if (!(await supabase.auth.getSession()).data.session) {
        const {error: authError} = await supabase.auth.signInAnonymously({options:{captchaToken:captcha || undefined}});
        if (authError) {
          (window as unknown as AuthWindow).turnstile?.reset();
          setCaptcha('');
          throw new Error('Não foi possível iniciar o acesso. Verifique a proteção e tente novamente.');
        }
        setSigned(true);
      }
      if (pending.kind === 'admin') {
        setAdminRows(await api<AdminCharacter[]>('admin_list',{token:pending.token}));
        setAdmin(pending.token);
      } else {
        const result = await api<{group:string;token?:string}>(pending.kind,{token:pending.token});
        setGroup(result.group);
        localStorage.setItem('ludra-last-group',result.group);
        setAgenda(await api<Agenda>('agenda',{group:result.group}));
        if (result.token) {
          setShare(makeLink('recover',result.token));
          setNotice('Acesso recuperado. Guarde o novo link.');
        }
      }
      setPending(null);
    });
  }

  useEffect(()=>{
    if (!challenge || !pending || signed || !siteKey || local) return;
    (window as unknown as AuthWindow).turnstile?.render('#turnstile',{
      sitekey:siteKey, theme:'dark', callback:setCaptcha,
      'expired-callback':()=>setCaptcha(''), 'error-callback':()=>setCaptcha(''),
    });
  },[challenge,pending,signed]);

  const today = day ? dateKey(new Date()) : '';
  const days = today ? Array.from({length:14},(_,index)=>nextDate(today,index)) : [];
  const mine = agenda?.characters.filter(character=>character.member_id===agenda.mine) ?? [];
  const currentChoice = mine.find(character=>character.id===choice)?.id ?? mine[0]?.id ?? '';
  const [dayStart,dayEnd] = dayBounds(day);
  const windows = agenda?.windows.filter(item=>Date.parse(item.starts_at)<dayEnd && Date.parse(item.ends_at)>Math.max(dayStart,Date.now())) ?? [];
  const coincidences = overlaps(windows,Math.max(dayStart,Date.now()),dayEnd);
  const range = (item:Window) => time(Math.max(dayStart,Date.parse(item.starts_at))) + '–' +
    (Date.parse(item.ends_at)>=dayEnd ? '00:00 (+1)' : time(item.ends_at));

  async function refresh() {setAgenda(await api<Agenda>('agenda',{group}));}

  function clearWindow() {
    setWindowId(null);setSelectedDays([today]);setStart('20:00');setEnd('22:00');setOvernight(false);setNote('');setRole('');
  }

  function editWindow(item:Window) {
    setWindowId(item.id);setChoice(item.character_id);
    const date = dateKey(new Date(item.starts_at));
    setSelectedDays([date]);setStart(time(item.starts_at));setEnd(time(item.ends_at));
    setOvernight(date!==dateKey(new Date(item.ends_at)));
    setNote(item.note ?? '');setRole(item.role_name ?? '');setTab('registro');
  }

  function editProfile(character?:Character) {
    setProfile(character ? {...character,level:String(character.level ?? ''),cp:String(character.cp ?? ''),gs:String(character.gs ?? ''),
      faction:character.faction ?? '',legion:character.legion ?? ''} : baseCharacter);
    setShowProfile(true);
  }

  function saveProfile(event:FormEvent) {
    event.preventDefault();
    void run(async()=>{
      const result=await api<{id:string}>('save_character',{group,...profile});
      setChoice(result.id);setShowProfile(false);
      await refresh();setNotice('Ficha salva.');
    });
  }

  function saveWindow(event:FormEvent) {
    event.preventDefault();
    void run(async()=>{
      await api('save_windows',{group,id:windowId,character:currentChoice,
        windows:selectedDays.map(date=>({day:date,start,end,overnight})),role_name:role,note});
      const firstDay = [...selectedDays].sort()[0];
      setDay(days.includes(firstDay) ? firstDay : today);
      clearWindow();await refresh();setTab('agenda');setNotice('Disponibilidade salva.');
    });
  }

  function remove(action:string,id:string,message:string) {
    if (confirm(message)) void run(async()=>{await api(action,{group,id});setChoice('');await refresh();setNotice('Registro removido.');});
  }

  async function copy(value:string) {
    if (navigator.clipboard?.writeText) {
      try {await navigator.clipboard.writeText(value);setNotice('Copiado para a área de transferência.');return;}
      catch { /* Some in-app browsers deny Clipboard API access. */ }
    }
    setShare(value);
    setNotice('Selecione o texto para copiar.');
  }

  function copyAgenda() {
    void copy([
      'Ludra Party · ' + prettyDay(day,{day:'numeric',month:'long'}) + ' · horário de Brasília',
      ...coincidences.map(item=>time(item.start)+'–'+(item.end===dayEnd?'00:00 (+1)':time(item.end))+
        ' · '+item.people+' pessoas · '+item.characters.length+' personagens'),
      ...windows.map(item=>range(item)+' · '+agenda?.characters.find(character=>character.id===item.character_id)?.nick),
    ].join('\n'));
  }

  return <main className="shell">
    <header className="top"><a href="/" className="brand"><span className="mark" aria-hidden>✦</span><span>LUDRA <b>PARTY</b></span></a>
      {agenda && <button className="quiet" disabled={busy} onClick={()=>void run(async()=>{
        const result=await api<{token:string}>('issue_recovery',{group});setShare(makeLink('recover',result.token));
        setNotice('Link pessoal. Guarde em segurança e não compartilhe com o grupo.');
      })}>Guardar meu acesso</button>}
    </header>

    <section className="hero">
      <div className="hero-copy"><div className="eyebrow">AION 2 <span>✦</span> AGENDA DO GRUPO</div>
      <h1>Ludra <em>Party</em></h1><p>Encontre um horário para jogar Ludra com o grupo.</p></div>
    </section>

    {error && <p className="feedback error" role="alert">{error}</p>}
    {notice && <p className="feedback" role="status">{notice}</p>}
    {share && <section className="panel share"><textarea aria-label="Texto para copiar" readOnly value={share} onFocus={event=>event.target.select()} />
      <div className="actions"><button type="button" onClick={()=>void copy(share)}>Copiar</button><button className="quiet" onClick={()=>setShare('')}>Fechar</button></div></section>}
    {!ready && <section className="panel"><p>Carregando…</p></section>}

    {ready && pending && <section className="panel access">
      <h2>{pending.kind==='recover'?'Recuperar meu acesso':pending.kind==='admin'?'Administração do grupo':'Entrar na agenda'}</h2>
      <p>{pending.kind==='recover'?'O link transfere seu acesso para este navegador.':'Use este navegador para continuar.'}</p>
      {!signed && siteKey && !local && <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={()=>setChallenge(true)} onError={()=>setError('A verificação não carregou. Tente abrir no navegador do aparelho.')} /><div id="turnstile" /></>}
      {(!supabase || (!signed && !siteKey && !local)) && <p>O acesso estará disponível após a configuração do ambiente.</p>}
      <button className="primary" disabled={busy || !supabase || (!signed && !local && !captcha)} onClick={()=>void enter()}>{busy?'Validando…':'Continuar'}</button>
    </section>}

    {ready && !pending && !agenda && !admin && <section className="panel access">
      <h2>Entre pelo convite do grupo</h2><p>Abra o link que o organizador compartilhou no WhatsApp. Você poderá cadastrar seu personagem e marcar seus horários.</p>
    </section>}

    {admin && <section className="panel"><h2>Administração do grupo</h2>
      <div className="actions">
        <button disabled={busy} onClick={()=>void run(async()=>{const result=await api<{token:string}>('admin_invite',{token:admin});
          setShare(makeLink('join',result.token));setNotice('Novo convite criado. O anterior foi revogado.');})}>Gerar convite</button>
        <button disabled={busy} onClick={()=>void run(async()=>{await api('admin_revoke',{token:admin});setShare('');setNotice('Convite revogado.');})}>Revogar convite</button>
      </div>
      {adminRows.map(item=><div className="person" key={item.id}><div><strong>{item.nick}</strong><small>{item.region} / {item.server}{item.duplicate?' · possível duplicata':''}</small></div>
        <button disabled={busy} onClick={()=>confirm('Remover este personagem e seus horários?') && void run(async()=>{
          await api('admin_remove',{token:admin,id:item.id});setAdminRows(await api('admin_list',{token:admin}));
        })}>Remover</button></div>)}
    </section>}

    {agenda && <>
      <nav className="tabs" aria-label="Agenda e registro">
        <button className={tab==='agenda'?'active':''} onClick={()=>setTab('agenda')}>Agenda do grupo</button>
        <button className={tab==='registro'?'active':''} onClick={()=>setTab('registro')}>Minha disponibilidade</button>
      </nav>
      {tab==='agenda' ? <section className="panel">
        <div className="section-head"><div><div className="eyebrow">PRÓXIMOS 14 DIAS</div><h2>{agenda.name}</h2></div>
          <button className="primary" onClick={()=>setTab('registro')}>+ Marcar horário</button></div>
        <div className="days" aria-label="Filtrar por data">{days.map(date=><button key={date} className={date===day?'selected':''}
          aria-pressed={date===day} onClick={()=>setDay(date)}><small>{prettyDay(date,{weekday:'short'})}</small><strong>{date.slice(-2)}</strong>
          <small>{prettyDay(date,{month:'short'})}</small></button>)}</div>
        <div className="section-head day-head"><div><h3>{prettyDay(day,{weekday:'long',day:'numeric',month:'long'})}</h3><small>Horário de Brasília · America/Sao_Paulo</small></div>
          <div className="actions"><button className="quiet" disabled={busy} onClick={()=>void run(async()=>{
            await refresh();setNotice('Agenda atualizada.');
          })}>Atualizar</button>
          {windows.length>0 && <button className="quiet" onClick={copyAgenda}>Copiar resumo</button>}</div></div>
        {coincidences.length>0 && <div className="overlap"><strong>Horários em comum</strong>{coincidences.map(item=><p key={item.start}>
          {time(item.start)}–{item.end===dayEnd?'00:00 (+1)':time(item.end)} · {item.people} pessoas · {item.characters.length} personagens</p>)}</div>}
        {windows.length===0 && <div className="empty"><span aria-hidden>◷</span><h3>Nenhum horário marcado</h3><p>Marque sua disponibilidade para começar.</p></div>}
        {windows.map(item=>{
          const character=agenda.characters.find(value=>value.id===item.character_id);
          if (!character) return null;
          return <article className="person" key={item.id}><span className="avatar">{initials(character.nick)}</span>
            <div className="person-info"><strong>{character.nick}</strong><small>{character.class_name} · {character.region} / {character.server}</small>
              <small>CP {character.cp ?? 'indisponível'} · GS {character.gs ?? 'indisponível'} · Manual</small>
              {(item.role_name || item.note) && <small>{[item.role_name,item.note].filter(Boolean).join(' · ')}</small>}</div>
            <div className="person-time"><strong>{range(item)}</strong>{item.member_id===agenda.mine && <div className="actions">
              <button className="quiet" onClick={()=>editWindow(item)}>Editar</button><button className="quiet" disabled={busy}
                onClick={()=>remove('delete_window',item.id,'Remover este horário?')}>Remover</button></div>}</div></article>;
        })}
      </section> : <section className="panel">
        <div className="section-head"><div><div className="eyebrow">SEUS PERSONAGENS</div><h2>Minha disponibilidade</h2></div><button onClick={()=>editProfile()}>+ Personagem</button></div>
        {mine.map(character=><article key={character.id} className="person"><span className="avatar">{initials(character.nick)}</span>
          <div className="person-info"><strong>{character.nick}</strong><small>{character.class_name} · {character.region} / {character.server}</small>
          <small>Nível {character.level ?? 'indisponível'} · CP {character.cp ?? 'indisponível'} · GS {character.gs ?? 'indisponível'}</small>
          {(character.faction || character.legion) && <small>{[character.faction,character.legion].filter(Boolean).join(' · ')}</small>}
          <small>Preenchimento manual · {new Date(character.updated_at).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}</small></div>
          <div className="actions"><button className="quiet" onClick={()=>editProfile(character)}>Editar</button><button className="quiet" disabled={busy}
            onClick={()=>remove('delete_character',character.id,'Remover o personagem e todos os seus horários?')}>Remover</button></div></article>)}
        {!showProfile && mine.length===0 && <p>Adicione um personagem para marcar seus horários.</p>}
        {showProfile && <form className="form" onSubmit={saveProfile}>
          <h3>{profile.id?'Editar personagem':'Adicionar personagem'}</h3><p>Busca oficial indisponível. Os dados desta ficha são preenchidos manualmente.</p>
          <div className="fields">{profileFields.map(([field,label,max,required])=><label key={field}>{label}
            <input value={profile[field]} maxLength={max} required={required}
              inputMode={['level','cp','gs'].includes(field)?'numeric':undefined}
              onChange={event=>setProfile({...profile,[field]:event.target.value})} /></label>)}</div>
          <div className="actions"><button className="primary" disabled={busy}>Salvar ficha</button><button type="button" onClick={()=>setShowProfile(false)}>Cancelar</button></div>
        </form>}
        {mine.length>0 && <form className="form" onSubmit={saveWindow}>
          <h3>{windowId?'Editar horário':'Marcar horário'}</h3>
          <p>Horário de Brasília · America/Sao_Paulo</p>
          <label>Personagem<select value={currentChoice} onChange={event=>setChoice(event.target.value)}>{mine.map(character=><option key={character.id} value={character.id}>{character.nick}</option>)}</select></label>
          <fieldset><legend>{windowId?'Data':'Dias disponíveis'}</legend><div className="days">{[...new Set([...selectedDays.filter(date=>!days.includes(date)),...days])].map(date=><button type="button" key={date}
            aria-pressed={selectedDays.includes(date)} className={selectedDays.includes(date)?'selected':''}
            onClick={()=>setSelectedDays(windowId?[date]:selectedDays.includes(date)?selectedDays.filter(item=>date!==item):[...selectedDays,date])}
            ><small>{prettyDay(date,{weekday:'short'})}</small><strong>{date.slice(-2)}</strong><small>{prettyDay(date,{month:'short'})}</small></button>)}</div></fieldset>
          <div className="fields"><label>Início<input required type="time" value={start} onChange={event=>setStart(event.target.value)} /></label>
          <label>Fim<input required type="time" value={end} onChange={event=>setEnd(event.target.value)} /></label></div>
          <label className="check"><input type="checkbox" checked={overnight} onChange={event=>setOvernight(event.target.checked)} />Termina no dia seguinte</label>
          <div className="fields"><label>Função preferida (opcional)<input maxLength={40} value={role} onChange={event=>setRole(event.target.value)} /></label>
          <label>Observação (opcional)<input maxLength={180} value={note} onChange={event=>setNote(event.target.value)} /></label></div>
          <div className="actions"><button className="primary" disabled={busy || selectedDays.length===0 || !currentChoice}>Salvar horários</button>
            {windowId && <button type="button" onClick={clearWindow}>Cancelar edição</button>}</div>
        </form>}
      </section>}
      <footer>Se você limpar os dados do navegador, use seu link pessoal para recuperar o acesso.</footer>
    </>}
  </main>;
}
