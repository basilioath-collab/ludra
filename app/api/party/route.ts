import { characterRef, readArmory, regions, searchArmory } from '../../../lib/armory';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

const tokenPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const saoPaulo = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo'});
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

class InputError extends Error {}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Dados inválidos.');
  return input as Record<string, unknown>;
}

function field(input: unknown, max: number, required = true): string | null {
  if (!required && (input === '' || input == null)) return null;
  if (typeof input !== 'string' || input.trim().length > max || (required && !input.trim())) {
    throw new InputError('Verifique os campos e seus limites.');
  }
  return input.trim() || null;
}

function id(input: unknown, optional = false) {
  if (optional && input == null) return null;
  if (typeof input !== 'string' || !uuidPattern.test(input)) throw new InputError('Identificador inválido.');
  return input;
}

function number(input: unknown, min = 0, max = 2147483647) {
  if (input == null || input === '') return null;
  if (typeof input !== 'string' || !/^\d{1,10}$/.test(input) || Number(input) < min || Number(input) > max) {
    throw new InputError('Verifique os valores numéricos da ficha.');
  }
  return Number(input);
}

function digest(input: unknown) {
  if (typeof input !== 'string' || !tokenPattern.test(input)) throw new InputError('Credencial inválida.');
  return createHash('sha256').update(input).digest('hex');
}

function windowData(input: unknown) {
  const { day, start, end, overnight } = object(input);
  if (typeof day !== 'string' || !dayPattern.test(day) || typeof start !== 'string' ||
      typeof end !== 'string' || !timePattern.test(start) || !timePattern.test(end) || typeof overnight !== 'boolean') {
    throw new InputError('Preencha a data e os horários.');
  }
  const calendarDay = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(+calendarDay) || calendarDay.toISOString().slice(0,10) !== day) throw new InputError('Data inválida.');
  const today = new Date(saoPaulo.format(new Date()) + 'T00:00:00Z');
  if (+calendarDay < +today - 86400000 || +calendarDay >= +today + 14 * 86400000) {
    throw new InputError('Escolha uma data no horizonte da agenda.');
  }
  // Brasília currently observes UTC−03:00 year-round.
  const startsAt = new Date(day + 'T' + start + ':00-03:00');
  const endsAt = new Date(day + 'T' + end + ':00-03:00');
  if (overnight) endsAt.setUTCDate(endsAt.getUTCDate() + 1);
  if (+endsAt <= Date.now() || +endsAt <= +startsAt || +endsAt - +startsAt > 86400000) {
    throw new InputError('A janela deve terminar no futuro e durar até 24 horas.');
  }
  return {start:startsAt.toISOString(), end:endsAt.toISOString()};
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {status,headers:{'Cache-Control':'no-store'}});
}

const guestCookie = 'ludra-guest';

function signGuest(id: string, secret: string) {
  return createHmac('sha256',secret).update('guest:' + id).digest('hex');
}

function readGuest(value: string, secret: string) {
  const [id,signature,extra] = value.split('.');
  if (extra !== undefined || !uuidPattern.test(id) || !tokenPattern.test(signature ?? '')) return null;
  return timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(signGuest(id,secret),'hex')) ? id : null;
}

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const local = process.env.NODE_ENV === 'development' && !!url && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url);
  const secret = process.env.RATE_LIMIT_SECRET || (local ? service : undefined);
  if (!url || !anon || !service || !secret || (!local && secret.length < 32)) {
    return response({error:'O ambiente ainda precisa da configuração do Supabase e do limite de requisições.'},503);
  }
  const authorization = request.headers.get('authorization') ?? '';
  if (!request.headers.get('content-type')?.startsWith('application/json')) return response({error:'Formato inválido.'},415);
  const options = {
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input:RequestInfo|URL,init?:RequestInit)=>
      fetch(input,{...init,signal:AbortSignal.timeout(8000)})},
  };
  try {
    if (Number(request.headers.get('content-length')) > 12000) return response({error:'Solicitação muito grande.'},413);
    const reader = request.body?.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    let size = 0;
    while (reader) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12000) {
        await reader.cancel();
        return response({error:'Solicitação muito grande.'},413);
      }
      raw += decoder.decode(value,{stream:true});
    }
    const body = object(JSON.parse(raw + decoder.decode()));
    const action = field(body.action,30);
    if (!action) throw new InputError('Operação inválida.');
    const guest = readGuest(request.cookies.get(guestCookie)?.value ?? '',secret);
    let userId = guest;
    let newGuest = false;
    if (['public_open','guest_session'].includes(action) && !userId && !authorization) {
      userId = randomUUID();
      newGuest = true;
    }
    if (authorization) {
      if (!authorization.startsWith('Bearer ') || authorization.length > 8192) return response({error:'Sessão inválida.'},401);
      const {data:{user},error:authError} = await createClient(url,anon,options).auth.getUser(authorization.slice(7));
      if (authError || !user?.is_anonymous) return response({error:'Sessão inválida.'},401);
      userId = user.id;
    }
    if (!userId) return response({error:'Sessão necessária.'},401);
    if (action === 'public_open' && authorization) return response({error:'Acesso inválido.'},400);
    const db = createClient(url,service,options);
    const limit = async (bucket:string, max:number) => {
      const {data,error} = await db.rpc('party_limit',{p_bucket:bucket,p_max:max});
      if (error) throw new Error('Rate limit unavailable');
      return data === true;
    };
    const sensitive = ['join','recover','admin_list','admin_remove','admin_invite','admin_revoke'].includes(action);
    if (sensitive || newGuest) {
      const ip = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const key = createHmac('sha256',secret).update(ip).digest('hex');
      if (!await limit('access:' + key,20)) return response({error:'Aguarde antes de tentar outro acesso.'},429);
    }

    const finish = (data: unknown) => {
      const result = response(data);
      if (newGuest) result.cookies.set(guestCookie,userId + '.' + signGuest(userId,secret),{
        httpOnly:true,secure:!local,sameSite:'lax',path:'/',maxAge:60*60*24*365,
      });
      return result;
    };
    if (action === 'guest_session') return finish({ok:true});

    if (!await limit((['agenda','raid_list'].includes(action) ? 'read:' : 'write:') + userId,['agenda','raid_list'].includes(action) ? 150 : 35)) {
      return response({error:'Muitas solicitações. Aguarde alguns minutos.'},429);
    }
    if (action === 'armory_search' || action === 'armory_profile') {
      try {
        if (action === 'armory_search') {
          const nick = field(body.nick,40);
          const region = field(body.region,3);
          if (!nick || !region || !Object.hasOwn(regions,region)) throw new InputError('Informe o nick e a região.');
          return finish(await searchArmory(nick,region));
        }
        const ref = characterRef(body.character);
        if (!ref) throw new InputError('Selecione um personagem da busca.');
        return finish(await readArmory(ref));
      } catch (cause) {
        if (cause instanceof InputError) throw cause;
        return response({error:'O arsenal da NCSoft não respondeu. Tente pesquisar novamente.'},502);
      }
    }
    if (['raid_list','raid_book','raid_leave','raid_rename'].includes(action)) {
      const args: Record<string,unknown> = {};
      if (action === 'raid_list') {
        if (typeof body.day !== 'string' || !dayPattern.test(body.day)) throw new InputError('Escolha o dia.');
        const start = new Date(body.day + 'T00:00:00-03:00');
        if (!Number.isFinite(+start) || start.toISOString().slice(0,10)!==body.day) throw new InputError('Data inválida.');
        args.start = start.toISOString();
        const days = body.days ?? 1;
        if (typeof days !== 'number' || !Number.isInteger(days) || days<1 || days>14) throw new InputError('Período inválido.');
        args.end = new Date(+start+days*86400000).toISOString();
      } else {
        args.run = id(body.run,action === 'raid_book');
      }
      if (action === 'raid_book') {
        if (body.party !== 1 && body.party !== 2) throw new InputError('Escolha PT1 ou PT2.');
        args.party = body.party;
        if (!args.run) {
          const {day,time} = body;
          if (typeof time !== 'string' || !timePattern.test(time)) throw new InputError('Escolha o horário.');
          const start = new Date(day + 'T' + time + ':00-03:00');
          if (typeof day !== 'string' || !dayPattern.test(day) || !Number.isFinite(+start) || +start<=Date.now() ||
              +start>Date.now()+14*86400000) throw new InputError('Escolha um horário futuro nos próximos 14 dias.');
          args.startsAt = start.toISOString();
          args.pt1Name = field(body.pt1Name,48,false);
          args.pt2Name = field(body.pt2Name,48,false);
        }
        const ref = characterRef(body.character);
        if (!ref) throw new InputError('Selecione um personagem da busca.');
        try {
          const profile = await readArmory(ref);
          Object.assign(args,profile,{characterKey:ref.region+'/'+ref.serverId+'/'+ref.id});
        } catch {
          return response({error:'O arsenal não respondeu. Sua vaga ainda não foi marcada.'},502);
        }
      }
      if (action === 'raid_rename') args.name = field(body.name,48,false);
      const {data,error} = await db.rpc('raid_action',{p_user:userId,p_action:action,p_data:args});
      if (error?.code === '23505') return response({error:'Você ou esse personagem já ocupa uma vaga nesta run.'},409);
      if (error?.code === '42501' || error?.code === 'P0001') return response({error:error.message},409);
      if (error) return response({error:'Não foi possível atualizar as runs.'},503);
      return finish(data);
    }
    const args: Record<string,unknown> = {};
    let newToken: string | undefined;
    if (['join','recover'].includes(action) || action.startsWith('admin_')) {
      args.hash = digest(body.token);
      if (action === 'join' || action === 'recover') args.guest = !authorization;
    } else if (action !== 'public_open') {
      args.group = id(body.group);
    }
    switch (action) {
      case 'public_open': case 'agenda': case 'join': case 'admin_list': case 'admin_revoke': break;
      case 'recover': case 'issue_recovery': case 'admin_invite':
        newToken = randomBytes(32).toString('hex');
        args.replacement = digest(newToken);
        break;
      case 'delete_character': case 'delete_window': case 'admin_remove':
        args.id = id(body.id);
        break;
      case 'save_character':
        Object.assign(args,{
          id:id(body.id,true), nick:field(body.nick,40), region:field(body.region,24),
          server:field(body.server,40), class_name:field(body.class_name,40),
          level:number(body.level,1,999), cp:number(body.cp), gs:number(body.gs),
          faction:field(body.faction,40,false), legion:field(body.legion,60,false),
        });
        break;
      case 'save_windows':
        if (!Array.isArray(body.windows) || body.windows.length < 1 || body.windows.length > 14) {
          throw new InputError('Escolha até 14 janelas por vez.');
        }
        Object.assign(args,{id:id(body.id,true),character:id(body.character),windows:body.windows.map(windowData),
          role_name:field(body.role_name,40,false),note:field(body.note,180,false)});
        break;
      default: throw new InputError('Operação inválida.');
    }
    const {data,error} = await db.rpc('party_action',{p_user:userId,p_action:action,p_data:args});
    if (error) {
      if (error.code === '42501') return response({error:error.message},403);
      if (error.code === '23505') {
        return response({error:action === 'recover' ? 'Abra o link em um navegador sem outro acesso a este grupo.' : 'Já existe uma ficha ou janela igual.'},409);
      }
      if (error.code === 'P0001') return response({error:error.message},400);
      return response({error:'O banco não concluiu a operação.'},503);
    }
    return finish(newToken ? {...data,token:newToken} : data);
  } catch (error) {
    if (error instanceof InputError || error instanceof SyntaxError) return response({error:error instanceof InputError ? error.message : 'Dados inválidos.'},400);
    return response({error:'O serviço está indisponível. Tente novamente.'},503);
  }
}
