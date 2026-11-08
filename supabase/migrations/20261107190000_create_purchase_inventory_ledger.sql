create table public.purchase_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supermarket_id uuid not null references public.supermarkets(id),
  branch_id uuid null references public.supermarket_branches(id),
  purchase_date date not null default current_date,
  receipt_reference text null,
  notes text null,
  created_at timestamptz not null default now(),
  constraint purchase_records_receipt_reference_length check (receipt_reference is null or char_length(receipt_reference) <= 120),
  constraint purchase_records_notes_length check (notes is null or char_length(notes) <= 1000)
);
create index purchase_records_user_date_idx on public.purchase_records(user_id, purchase_date desc);
create index purchase_records_store_idx on public.purchase_records(user_id, supermarket_id, purchase_date desc);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchase_records(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid null references public.products(id) on delete set null,
  item_name text not null,
  package_description text null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit text not null default 'unidad',
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now(),
  constraint purchase_items_name_length check (char_length(item_name) between 1 and 180),
  constraint purchase_items_unit_length check (char_length(unit) between 1 and 40),
  constraint purchase_items_package_length check (package_description is null or char_length(package_description) <= 180)
);
create index purchase_items_user_product_idx on public.purchase_items(user_id, product_id);
create index purchase_items_purchase_idx on public.purchase_items(purchase_id);

create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid null references public.products(id) on delete set null,
  item_name text not null,
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  reason text not null check (reason in ('consumption','spoilage','correction')),
  notes text null,
  occurred_at timestamptz not null default now(),
  constraint inventory_adjustments_name_length check (char_length(item_name) between 1 and 180),
  constraint inventory_adjustments_notes_length check (notes is null or char_length(notes) <= 500)
);
create index inventory_adjustments_user_product_idx on public.inventory_adjustments(user_id, product_id, occurred_at desc);

alter table public.purchase_records enable row level security;
alter table public.purchase_items enable row level security;
alter table public.inventory_adjustments enable row level security;

create policy "Users manage own purchase records"
on public.purchase_records for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users manage own purchase items"
on public.purchase_items for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (select 1 from public.purchase_records p where p.id = purchase_id and p.user_id = (select auth.uid()))
)
with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.purchase_records p where p.id = purchase_id and p.user_id = (select auth.uid()))
);

create policy "Users manage own inventory adjustments"
on public.inventory_adjustments for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.purchase_records to authenticated;
grant select, insert, update, delete on public.purchase_items to authenticated;
grant select, insert, update, delete on public.inventory_adjustments to authenticated;
