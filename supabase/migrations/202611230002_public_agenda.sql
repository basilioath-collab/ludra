begin;

alter table public.groups add column public_access boolean not null default false;
create unique index groups_single_public_idx on public.groups (public_access) where public_access;

alter table public.memberships
  alter column auth_id drop not null,
  add column guest_id uuid,
  add constraint memberships_one_identity check (num_nonnulls(auth_id,guest_id) = 1),
  add constraint memberships_unique_guest unique (group_id,guest_id);

create or replace function public.party_action(p_user uuid, p_action text, p_data jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_group uuid;
  v_member uuid;
  v_character uuid;
  v_window uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_item jsonb;
begin
  if p_user is null then raise exception 'Sessão necessária' using errcode = '42501'; end if;

  if p_action = 'public_open' then
    select id into v_group from public.groups where public_access for share;
    if v_group is null then raise exception 'Agenda pública indisponível' using errcode = '42501'; end if;
    insert into public.memberships(group_id,guest_id) values(v_group,p_user)
      on conflict (group_id,guest_id) do nothing;
    return jsonb_build_object('group',v_group);
  elsif p_action = 'join' then
    select id into v_group from public.groups where invite_hash = p_data->>'hash' for share;
    if v_group is null then raise exception 'Convite inválido ou revogado' using errcode = '42501'; end if;
    if p_data->>'guest' = 'true' then
      insert into public.memberships(group_id,guest_id) values(v_group,p_user)
        on conflict (group_id,guest_id) do nothing;
    else
      insert into public.memberships(group_id,auth_id) values(v_group,p_user)
        on conflict (group_id,auth_id) do nothing;
    end if;
    return jsonb_build_object('group',v_group);
  elsif p_action = 'recover' then
    select m.id,m.group_id into v_member,v_group
    from public.memberships m join public.recovery_tokens t on t.member_id=m.id
    where t.token_hash=p_data->>'hash' for update of m;
    if v_member is null then raise exception 'Link inválido ou já utilizado' using errcode = '42501'; end if;
    delete from public.recovery_tokens where member_id=v_member and token_hash=p_data->>'hash';
    if not found then raise exception 'Link já utilizado' using errcode = '42501'; end if;
    update public.memberships set
      auth_id=case when p_data->>'guest' = 'true' then null else p_user end,
      guest_id=case when p_data->>'guest' = 'true' then p_user else null end
    where id=v_member;
    insert into public.recovery_tokens(token_hash,member_id) values(p_data->>'replacement',v_member);
    return jsonb_build_object('group',v_group);
  elsif p_action in ('admin_list','admin_remove','admin_invite','admin_revoke') then
    select id into v_group from public.groups where admin_hash=p_data->>'hash' for update;
    if v_group is null then raise exception 'Credencial inválida' using errcode = '42501'; end if;
    if p_action = 'admin_list' then
      return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'nick',c.nick,'server',c.server,'region',c.region,
        'duplicate',exists(select 1 from public.characters other where other.group_id=c.group_id and other.id<>c.id
          and lower(other.nick)=lower(c.nick) and lower(other.server)=lower(c.server) and lower(other.region)=lower(c.region)))
        order by c.nick),'[]'::jsonb) from public.characters c where c.group_id=v_group);
    elsif p_action = 'admin_remove' then
      delete from public.characters where group_id=v_group and id=(p_data->>'id')::uuid;
    else
      update public.groups set invite_hash=p_data->>'replacement' where id=v_group;
    end if;
    return '{}'::jsonb;
  end if;

  v_group := (p_data->>'group')::uuid;
  -- The row lock serializes quotas and ownership changes for a participant.
  select id into v_member from public.memberships where group_id=v_group and (auth_id=p_user or guest_id=p_user) for update;
  if v_member is null then raise exception 'Entre pelo convite do grupo' using errcode = '42501'; end if;

  if p_action = 'agenda' then
    return jsonb_build_object(
      'name',(select name from public.groups where id=v_group),
      'mine',v_member,
      'characters',(select coalesce(jsonb_agg(to_jsonb(c)-'group_id' order by nick),'[]'::jsonb)
        from public.characters c where group_id=v_group and (member_id=v_member or exists
          (select 1 from public.availability_windows w where w.character_id=c.id and w.ends_at>now()))),
      'windows',(select coalesce(jsonb_agg(to_jsonb(w)-'group_id' order by starts_at),'[]'::jsonb)
        from public.availability_windows w where group_id=v_group and ends_at>now()));
  elsif p_action = 'save_character' then
    v_character := (p_data->>'id')::uuid;
    if v_character is null then
      if (select count(*) from public.characters where member_id=v_member) >= 5 then
        raise exception 'Limite de cinco personagens atingido';
      end if;
      insert into public.characters(group_id,member_id,nick,region,server,class_name,level,cp,gs,faction,legion)
      values(v_group,v_member,p_data->>'nick',p_data->>'region',p_data->>'server',p_data->>'class_name',
        (p_data->>'level')::integer,(p_data->>'cp')::integer,(p_data->>'gs')::integer,p_data->>'faction',p_data->>'legion')
      returning id into v_character;
    else
      update public.characters set nick=p_data->>'nick',region=p_data->>'region',server=p_data->>'server',
        class_name=p_data->>'class_name',level=(p_data->>'level')::integer,cp=(p_data->>'cp')::integer,
        gs=(p_data->>'gs')::integer,faction=p_data->>'faction',legion=p_data->>'legion',updated_at=now()
      where id=v_character and member_id=v_member and group_id=v_group;
      if not found then raise exception 'Personagem indisponível' using errcode = '42501'; end if;
    end if;
    return jsonb_build_object('id',v_character);
  elsif p_action = 'delete_character' then
    delete from public.characters where id=(p_data->>'id')::uuid and group_id=v_group and member_id=v_member;
    if not found then raise exception 'Personagem indisponível' using errcode = '42501'; end if;
  elsif p_action = 'save_windows' then
    v_character := (p_data->>'character')::uuid;
    if not exists (select 1 from public.characters where id=v_character and group_id=v_group and member_id=v_member) then
      raise exception 'Personagem indisponível' using errcode = '42501';
    end if;
    v_window := (p_data->>'id')::uuid;
    if jsonb_array_length(p_data->'windows') not between 1 and 14 or
       (v_window is not null and jsonb_array_length(p_data->'windows') <> 1) then
      raise exception 'Quantidade de janelas inválida';
    end if;
    if (select count(*) from public.availability_windows where member_id=v_member and ends_at>now()
        and id is distinct from v_window) + jsonb_array_length(p_data->'windows') > 30 then
      raise exception 'Limite de 30 janelas futuras atingido';
    end if;
    for v_item in select value from jsonb_array_elements(p_data->'windows') loop
      v_start := (v_item->>'start')::timestamptz;
      v_end := (v_item->>'end')::timestamptz;
      if v_start < now() - interval '24 hours' or v_end <= now() or v_end > now()+interval '15 days' then
        raise exception 'Escolha uma janela que termine no horizonte de 14 dias';
      end if;
      if v_window is null then
        insert into public.availability_windows(group_id,member_id,character_id,starts_at,ends_at,role_name,note)
        values(v_group,v_member,v_character,v_start,v_end,p_data->>'role_name',p_data->>'note');
      else
        update public.availability_windows set character_id=v_character,starts_at=v_start,ends_at=v_end,
          role_name=p_data->>'role_name',note=p_data->>'note' where id=v_window and member_id=v_member and group_id=v_group;
        if not found then raise exception 'Janela indisponível' using errcode = '42501'; end if;
      end if;
    end loop;
  elsif p_action = 'delete_window' then
    delete from public.availability_windows where id=(p_data->>'id')::uuid and group_id=v_group and member_id=v_member;
    if not found then raise exception 'Janela indisponível' using errcode = '42501'; end if;
  elsif p_action = 'issue_recovery' then
    insert into public.recovery_tokens(token_hash,member_id) values(p_data->>'replacement',v_member)
    on conflict(member_id) do update set token_hash=excluded.token_hash;
  else
    raise exception 'Operação inválida';
  end if;
  return '{}'::jsonb;
end $$;

commit;
