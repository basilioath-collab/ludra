export type CharacterRef = { id: string; serverId: string; region: string };
export type CharacterMatch = CharacterRef & { nick: string; server: string };
export type ArmoryProfile = CharacterMatch & { className: string; cp: number | null; gs: number | null; portrait: string | null };

export type ArmoryDetail = ArmoryProfile & {
  level:number|null;
  faction:string|null;
  equipment:{name:string;slot:string;grade:string|null;enchant:number|null;icon:string|null}[]|null;
  skills:{name:string;level:number|null;icon:string|null;stigma:boolean;equipped:boolean}[]|null;
  boards:{name:string;percent:number|null}[];
};

type CharacterInfo = {
  profile?:{characterName:string;serverName:string;className:string;combatPower:unknown;
    profileImage?:unknown;characterLevel?:unknown;raceName?:unknown};
  stat?:{statList?:Array<{type:string;value:unknown}>};
  daevanion?:{boardList?:Record<string,unknown>[]};
};

export const regions = {la:'América do Sul', nae:'América do Norte · Leste', naw:'América do Norte · Oeste', eu:'Europa', as:'Ásia'} as const;
const searchEndpoint = 'https://api-search.plaync.com/aion2global/search/v2/character';
const profileEndpoint = 'https://aion2.plaync.com/api/character/info';
const equipmentEndpoint = 'https://aion2.plaync.com/api/character/equipment';

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

function imageUrl(value:unknown):string|null {
  if (typeof value!=='string' || !value.trim() || value.length>2048) return null;
  try {
    const url = new URL(value,'https://aion2.plaync.com');
    return url.protocol==='https:' && !url.username && !url.password ? url.href : null;
  } catch {return null;}
}

function label(value:unknown):string|null {
  return typeof value==='string' ? value.trim().slice(0,120) || null : null;
}

function characterParams(ref:CharacterRef) {
  return {region:ref.region,lang:'en-US',characterId:ref.id,serverId:ref.serverId};
}

function summary(ref:CharacterRef, data:CharacterInfo):ArmoryProfile {
  const {profile,stat:stats} = data;
  if (!profile || ![profile.characterName,profile.serverName,profile.className].every(value=>typeof value==='string' && value.trim())) {
    throw new Error('Perfil indisponível');
  }
  const itemLevel = stats?.statList?.find(entry=>entry.type.toLowerCase()==='itemlevel');
  return {...ref,nick:profile.characterName,server:profile.serverName,className:profile.className,
    cp:stat(profile.combatPower),gs:stat(itemLevel?.value),portrait:imageUrl(profile.profileImage)};
}

export async function readArmory(ref:CharacterRef):Promise<ArmoryProfile> {
  return summary(ref,await ncsoft<CharacterInfo>(profileEndpoint,characterParams(ref)));
}

export async function readArmoryDetails(ref:CharacterRef):Promise<ArmoryDetail> {
  type Items = {equipment?:{equipmentList?:Record<string,unknown>[]};skill?:{skillList?:Record<string,unknown>[]} };
  const params=characterParams(ref);
  const [info,items]=await Promise.all([
    ncsoft<CharacterInfo>(profileEndpoint,params),
    ncsoft<Items>(equipmentEndpoint,params).catch(()=>null),
  ]);
  const equipment=items?.equipment?.equipmentList;
  const skills=items?.skill?.skillList;
  const boards=info.daevanion?.boardList;
  return {
    ...summary(ref,info),level:stat(info.profile?.characterLevel),faction:label(info.profile?.raceName),
    equipment:Array.isArray(equipment) ? equipment.slice(0,40).flatMap(item=>{
      const name=label(item?.name);
      return name ? [{name,slot:label(item.slotPosName)??'',grade:label(item.grade),
        enchant:stat(item.enchantLevel),icon:imageUrl(item.icon)}] : [];
    }) : null,
    skills:Array.isArray(skills) ? skills.slice(0,120).flatMap(item=>{
      const name=label(item?.name);
      return name ? [{name,level:stat(item.skillLevel),icon:imageUrl(item.icon),
        stigma:/stigma/i.test(String(item.category??'')),equipped:item.equip===true||item.equip===1||item.equip==='Y'}] : [];
    }) : null,
    boards:Array.isArray(boards) ? boards.slice(0,20).flatMap(item=>{
      const name=label(item?.name);
      const percent=typeof item?.openPercent==='number' && Number.isFinite(item.openPercent) ? item.openPercent : null;
      return name ? [{name,percent}] : [];
    }) : [],
  };
}
