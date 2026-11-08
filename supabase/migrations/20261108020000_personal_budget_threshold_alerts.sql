create table if not exists public.personal_budget_alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  threshold integer not null check (threshold in (75, 90, 100)),
  triggered_at timestamptz not null default now(),
  primary key (user_id, period_start, threshold)
);

alter table public.personal_budget_alerts enable row level security;

drop policy if exists "Users read own personal budget alerts" on public.personal_budget_alerts;
create policy "Users read own personal budget alerts"
on public.personal_budget_alerts
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create own personal budget alerts" on public.personal_budget_alerts;
create policy "Users create own personal budget alerts"
on public.personal_budget_alerts
for insert
to authenticated
with check ((select auth.uid()) = user_id);

grant select, insert on public.personal_budget_alerts to authenticated;
