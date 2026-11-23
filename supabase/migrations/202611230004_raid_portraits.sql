begin;
alter table public.raid_slots add column portrait text check (portrait is null or length(portrait) <= 2048);

create or replace function public.raid_action(p_user uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_group uuid;
  v_member uuid;
  v_run uuid;
  v_party smallint;
  v_slot smallint;
  v_time timestamptz;
begin
  select m.group_id,m.id into v_group,v_member
  from public.memberships m join public.groups g on g.id=m.group_id
  where g.public_access and (m.guest_id=p_user or m.auth_id=p_user);
  if v_member is null then raise exception 'Abra o painel de runs primeiro.' using errcode='42501'; end if;

  if p_action='raid_list' then
    return coalesce((
      select jsonb_agg(jsonb_build_object('id',r.id,'startsAt',r.starts_at,'slots',coalesce((
        select jsonb_agg(jsonb_build_object('party',s.party,'slot',s.slot,'nick',s.nick,
          'server',s.server,'className',s.class_name,'cp',s.cp,'gs',s.gs,'portrait',s.portrait,'mine',s.member_id=v_member)
          order by s.party,s.slot) from public.raid_slots s where s.run_id=r.id
      ),'[]'::jsonb)) order by r.starts_at,r.id)
      from public.raid_runs r where r.group_id=v_group
        and r.starts_at >= (p_data->>'start')::timestamptz and r.starts_at < (p_data->>'end')::timestamptz
    ),'[]'::jsonb);
  end if;

  v_run := (p_data->>'run')::uuid;
  if p_action='raid_book' and v_run is null then
    v_time := (p_data->>'startsAt')::timestamptz;
    if v_time <= now() then raise exception 'Escolha um horário futuro.'; end if;
    insert into public.raid_runs(group_id,starts_at) values(v_group,v_time) returning id into v_run;
  else
    select starts_at into v_time from public.raid_runs where id=v_run and group_id=v_group for update;
    if not found then raise exception 'Esta run não está disponível.' using errcode='42501'; end if;
  end if;

  if p_action='raid_leave' then
    delete from public.raid_slots where run_id=v_run and member_id=v_member;
    if not found then raise exception 'Você não ocupa uma vaga nesta run.' using errcode='42501'; end if;
    if not exists(select 1 from public.raid_slots where run_id=v_run) then
      delete from public.raid_runs where id=v_run;
    end if;
  elsif p_action='raid_book' then
    if v_time is not null and v_time <= now() then raise exception 'Esta run já começou.'; end if;
    v_party := (p_data->>'party')::smallint;
    select n into v_slot from generate_series(1,5) n
    where not exists(select 1 from public.raid_slots where run_id=v_run and party=v_party and slot=n)
    order by n limit 1;
    if v_slot is null then raise exception 'Esta PT está cheia.'; end if;
    insert into public.raid_slots(run_id,member_id,character_key,party,slot,nick,server,class_name,cp,gs,portrait)
    values(v_run,v_member,p_data->>'characterKey',v_party,v_slot,p_data->>'nick',p_data->>'server',
      p_data->>'className',(p_data->>'cp')::integer,(p_data->>'gs')::integer,p_data->>'portrait');
  else
    raise exception 'Operação inválida.';
  end if;
  return jsonb_build_object('id',v_run);
end;
$$;

commit;
