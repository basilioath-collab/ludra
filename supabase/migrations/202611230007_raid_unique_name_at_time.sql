create unique index raid_runs_unique_name_at_time
  on public.raid_runs (group_id, starts_at, lower(btrim(name)))
  where name is not null;
