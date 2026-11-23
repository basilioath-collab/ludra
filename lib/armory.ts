export type CharacterRef = { id: string; serverId: string; region: string };
export type CharacterMatch = CharacterRef & { nick: string; server: string };
export type ArmoryProfile = CharacterMatch & { className: string; cp: number | null; gs: number | null };

export const regions = {la:'América do Sul', nae:'América do Norte · Leste', naw:'América do Norte · Oeste', eu:'Europa', as:'Ásia'} as const;
const searchEndpoint = 'https://api-search.plaync.com/aion2global/search/v2/character';
const profileEndpoint = 'https://aion2.plaync.com/api/character/info';

async function ncsoft<T>(endpoint:string, params:Record<string,string>):Promise<T> {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(params).toString();
  const result = await fetch(url,{
    headers:{Accept:'application/json',Referer:'https://aion2.plaync.com/en-us/characters/index'},
    signal:AbortSignal.timeout(6500),
    next:{revalidate:60},
  });
  if (!result.ok) throw new Error('Arsenal indisponível');
  return result.json() as Promise<T>;
}

export function characterRef(value:unknown):CharacterRef | null {
  if (!value || typeof value !== 'object') return null;
  const {id,serverId,region} = value as Partial<CharacterRef>;
  if (typeof id !== 'string' || !/^[A-Za-z0-9+/=_-]{1,200}$/.test(id) ||
      typeof serverId !== 'string' || !/^\d{1,8}$/.test(serverId) ||
      typeof region !== 'string' || !Object.hasOwn(regions,region)) return null;
  return {id,serverId,region};
}

export async function searchArmory(nick:string, region:string):Promise<CharacterMatch[]> {
  type Result = {list?:Array<{characterId:string;name:string;serverId:string|number;serverName:string}>};
  const data = await ncsoft<Result>(searchEndpoint,{keyword:nick,region,localeInfo:'en-US'});
  if (!Array.isArray(data.list)) throw new Error('Resposta inválida do arsenal');
  return data.list.slice(0,20).flatMap(item=>{
    if (typeof item.characterId !== 'string' || typeof item.name !== 'string' || typeof item.serverName !== 'string') return [];
    let id = item.characterId.replace(/%25/g,'%');
    try { id = decodeURIComponent(id); } catch { return []; }
    const ref = characterRef({id,serverId:String(item.serverId),region});
    return ref ? [{...ref,nick:item.name.replace(/<\/?strong>/gi,''),server:item.serverName}] : [];
  });
}

function stat(value:unknown):number|null {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2147483647 ? parsed : null;
}

export async function readArmory(ref:CharacterRef):Promise<ArmoryProfile> {
  type Result = {
    profile?:{characterName:string;serverName:string;className:string;combatPower:unknown};
    stat?:{statList?:Array<{type:string;value:unknown}>};
  };
  const {profile,stat:stats} = await ncsoft<Result>(profileEndpoint,{
    region:ref.region,lang:'en-US',characterId:ref.id,serverId:ref.serverId,
  });
  if (!profile || ![profile.characterName,profile.serverName,profile.className].every(value=>typeof value==='string' && value.trim())) {
    throw new Error('Perfil indisponível');
  }
  const itemLevel = stats?.statList?.find(entry=>entry.type.toLowerCase()==='itemlevel');
  return {...ref,nick:profile.characterName,server:profile.serverName,className:profile.className,
    cp:stat(profile.combatPower),gs:stat(itemLevel?.value)};
}
