create table if not exists public.personal_pantry_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_name text not null check (length(btrim(item_name)) between 1 and 120),
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  unit text not null default 'unidad' check (length(btrim(unit)) between 1 and 40),
  minimum_quantity numeric(12,3) not null default 0 check (minimum_quantity >= 0),
  location text check (location is null or length(location) <= 80),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists personal_pantry_items_user_updated_idx
  on public.personal_pantry_items (user_id, updated_at desc);

alter table public.personal_pantry_items enable row level security;

drop policy if exists "Users manage own personal pantry" on public.personal_pantry_items;
create policy "Users manage own personal pantry"
on public.personal_pantry_items
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.personal_pantry_items to authenticated;
