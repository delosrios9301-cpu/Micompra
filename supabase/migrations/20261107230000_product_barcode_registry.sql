create table public.product_barcodes (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  barcode text not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint product_barcodes_barcode_format check (barcode = upper(barcode) and barcode ~ '^[A-Z0-9]{4,64}$'),
  constraint product_barcodes_barcode_unique unique (barcode)
);

create index product_barcodes_product_id_idx on public.product_barcodes(product_id);

create or replace function public.prevent_duplicate_product_barcode()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.products p
    where nullif(regexp_replace(upper(coalesce(p.barcode, '')), '[[:space:]-]+', '', 'g'), '') = new.barcode
  ) then
    raise exception 'Este código ya está asignado en el catálogo principal.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_duplicate_product_barcode() from public, anon, authenticated;

create trigger product_barcodes_prevent_primary_duplicate
before insert or update of barcode on public.product_barcodes
for each row execute function public.prevent_duplicate_product_barcode();

alter table public.product_barcodes enable row level security;

grant select, insert, delete on public.product_barcodes to authenticated;
grant usage, select on sequence public.product_barcodes_id_seq to authenticated;

create policy "Authenticated users can read product barcodes"
on public.product_barcodes
for select
to authenticated
using (true);

create policy "First reviewer can add product barcodes"
on public.product_barcodes
for insert
to authenticated
with check (
  (select public.is_price_reviewer())
  and created_by = (select auth.uid())
);

create policy "First reviewer can remove product barcodes"
on public.product_barcodes
for delete
to authenticated
using ((select public.is_price_reviewer()));
