'use client';

import { useEffect, useRef, useState } from 'react';
import type { ArmoryDetail, ArmoryProfile } from '../lib/armory';
import { CharacterPortrait } from './raid-character';

type Summary = Pick<ArmoryProfile,'nick'|'server'|'className'|'portrait'|'cp'|'gs'>;
const number=new Intl.NumberFormat('pt-BR');
const format=(value:number|null)=>value===null?'—':number.format(value);

function ItemIcon({url}:{url:string|null}) {
  const [failed,setFailed]=useState(false);
  return <span className="raid-item-icon" aria-hidden>
    {url && !failed && <img src={url} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>}
  </span>;
}

export function RaidProfile({summary,details,error,onClose}:{
  summary:Summary;details?:ArmoryDetail;error:string;onClose:()=>void;
}) {
  const modal=useRef<HTMLDialogElement>(null);
  useEffect(()=>{modal.current?.showModal();},[]);
  const profile=details??summary;
  const stigmas=details?.skills?.filter(skill=>skill.stigma&&skill.equipped)??[];
  const otherSkills=details?.skills?.filter(skill=>!skill.stigma)??[];

  return <dialog ref={modal} className="raid-profile" aria-labelledby="raid-profile-title" onClose={onClose}>
    <header className="raid-profile-head">
      <CharacterPortrait nick={profile.nick} portrait={profile.portrait} className={profile.className}/>
      <div><h2 id="raid-profile-title">{profile.nick}</h2>
        <p>{[profile.className,profile.server,details?.level ? 'Nível '+details.level : null,details?.faction].filter(Boolean).join(' · ')}</p></div>
      <form method="dialog"><button type="submit" aria-label="Fechar ficha">×</button></form>
    </header>
    <dl className="raid-profile-stats"><div><dt>CP</dt><dd>{format(profile.cp)}</dd></div>
      <div><dt>GS</dt><dd>{format(profile.gs)}</dd></div></dl>
    {!details && <p className="raid-profile-feedback" role={error?'alert':'status'}>
      {error || 'Consultando o arsenal…'}</p>}
    {details && <div className="raid-profile-sections">
      <section aria-labelledby="raid-gear-title">
        <h3 id="raid-gear-title">Equipamento</h3>
        {details.equipment?.length ? <ul className="raid-item-list">{details.equipment.map((item,index)=>
          <li key={item.slot+'/'+item.name+'/'+index}><ItemIcon url={item.icon}/>
            <div><strong>{item.name}{item.enchant!==null&&item.enchant>0 ? ' +' + item.enchant : ''}</strong>
              <small>{[item.slot,item.grade].filter(Boolean).join(' · ')}</small></div>
          </li>)}</ul> : <p>{details.equipment===null?'Equipamento indisponível no arsenal.':'Nenhum equipamento retornado.'}</p>}
      </section>
      <details>
        <summary>Estigmas {stigmas.length>0 && <span>{stigmas.length}</span>}</summary>
        {stigmas.length ? <ul className="raid-item-list">{stigmas.map((item,index)=><li key={item.name+'/'+index}>
          <ItemIcon url={item.icon}/><div><strong>{item.name}</strong>{item.level!==null && <small>Nível {item.level}</small>}</div>
        </li>)}</ul> : <p>Nenhum estigma equipado informado pelo arsenal.</p>}
      </details>
      <details>
        <summary>Habilidades {otherSkills.length>0 && <span>{otherSkills.length}</span>}</summary>
        {otherSkills.length ? <ul className="raid-item-list">{otherSkills.map((item,index)=><li key={item.name+'/'+index}>
          <ItemIcon url={item.icon}/><div><strong>{item.name}</strong>{item.level!==null && <small>Nível {item.level}</small>}</div>
        </li>)}</ul> : <p>Nenhuma habilidade retornada pelo arsenal.</p>}
      </details>
      {details.boards.length>0 && <details><summary>Daevanion</summary>
        <ul className="raid-item-list">{details.boards.map((board,index)=><li key={board.name+'/'+index}>
          <strong>{board.name}</strong>{board.percent!==null && <small>{board.percent}% aberto</small>}</li>)}</ul>
      </details>}
    </div>}
  </dialog>;
}
