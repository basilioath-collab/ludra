'use client';

import { useState } from 'react';

const classIcons:Record<string,string> = {
  gladiator:'⚔',templar:'⛨',assassin:'✦',ranger:'➶',sorcerer:'✧',spiritmaster:'◈',cleric:'✚',chanter:'☼',
};

export function CharacterPortrait({nick,portrait,className}:{nick:string;portrait?:string|null;className:string}) {
  const [failed,setFailed] = useState<string>();
  const icon = classIcons[className.toLowerCase().replace(/\s/g,'')] ?? '◇';
  return <span className="raid-portrait">
    {portrait && failed!==portrait ? <img src={portrait} alt="" width={52} height={52} loading="lazy"
      referrerPolicy="no-referrer" onError={()=>setFailed(portrait)}/> : <span aria-hidden>{[...nick].slice(0,2).join('').toUpperCase()}</span>}
    <span className="raid-class-icon" aria-label={className} title={className}>{icon}</span>
  </span>;
}
