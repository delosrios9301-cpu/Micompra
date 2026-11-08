create table if not exists public.personal_budget_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_budget numeric(12,2) not null default 0 check (monthly_budget >= 0),
  updated_at timestamptz not null default now()
);

alter table public.personal_budget_settings enable row level security;

drop policy if exists "Users manage own personal budget" on public.personal_budget_settings;
create policy "Users manage own personal budget"
on public.personal_budget_settings
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update on public.personal_budget_settings to authenticated;
