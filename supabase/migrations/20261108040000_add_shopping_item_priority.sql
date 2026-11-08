alter table public.shopping_list_items
  add column if not exists priority text not null default 'normal'
  check (priority in ('urgent', 'normal', 'low'));

comment on column public.shopping_list_items.priority is
  'Personal shopping priority: urgent, normal, or low.';
