-- Normalize every alternate barcode at the database boundary and enforce uniqueness
-- after removing spaces and hyphens, regardless of the client used to write it.

create or replace function public.prevent_duplicate_product_barcode()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.barcode := regexp_replace(upper(coalesce(new.barcode, '')), '[[:space:]-]+', '', 'g');

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

create unique index if not exists product_barcodes_normalized_unique_idx
on public.product_barcodes (
  (regexp_replace(upper(barcode), '[[:space:]-]+', '', 'g'))
);
