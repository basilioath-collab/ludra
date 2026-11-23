'use client';

import { useState } from 'react';

// The English armory names for Spiritmaster and Brawler differ from the CDN filenames.
const classIcons = new Map([
  ['gladiator','gladiator'],
  ['templar','templar'],
  ['assassin','assassin'],
  ['ranger','ranger'],
  ['sorcerer','sorcerer'],
  ['spiritmaster','elementalist'],
  ['elementalist','elementalist'],
  ['cleric','cleric'],
  ['chanter','chanter'],
  ['brawler','fighter'],
  ['fighter','fighter'],
]);

export function CharacterPortrait({nick,portrait,className}:{nick:string;portrait?:string|null;className:string}) {
  const [failed,setFailed] = useState<string>();
  const icon = classIcons.get(className.toLowerCase().replace(/\s/g,''));
  return <span className="raid-portrait">
    {portrait && failed!==portrait ? <img src={portrait} alt="" width={52} height={52} loading="lazy"
      referrerPolicy="no-referrer" onError={()=>setFailed(portrait)}/> : <span aria-hidden>{[...nick].slice(0,2).join('').toUpperCase()}</span>}
    {icon && <span className="raid-class-icon" title={className}>
      <img src={'/class-icons/'+icon+'.png'} alt={className} width={20} height={20} loading="lazy"/>
    </span>}
  </span>;
}
