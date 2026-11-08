alter table public.shopping_list_items
  add column if not exists planned_for date;

create index if not exists shopping_list_items_list_planned_for_idx
  on public.shopping_list_items (list_id, planned_for)
  where planned_for is not null;
