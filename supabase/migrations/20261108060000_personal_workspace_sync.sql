create table if not exists public.personal_workspace (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"version":1,"catalog":[],"cart":[],"purchases":[],"pantry":[],"settings":{}}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint personal_workspace_data_is_object check (jsonb_typeof(data) = 'object')
);

alter table public.personal_workspace enable row level security;

drop policy if exists "Users manage own personal workspace" on public.personal_workspace;
create policy "Users manage own personal workspace"
on public.personal_workspace
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update on table public.personal_workspace to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'personal_workspace'
  ) then
    execute 'alter publication supabase_realtime add table public.personal_workspace';
  end if;
end
$$;
