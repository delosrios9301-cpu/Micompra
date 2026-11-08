-- Enforce normalized uniqueness for primary catalog barcodes and prevent
-- a primary barcode from colliding with an alternate barcode.

create or replace function public.prevent_duplicate_primary_product_barcode()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  normalized_code text;
begin
  normalized_code := nullif(regexp_replace(upper(coalesce(new.barcode, '')), '[[:space:]-]+', '', 'g'), '');
  if normalized_code is null then
    return new;
  end if;

  if exists (
    select 1
    from public.product_barcodes b
    where regexp_replace(upper(b.barcode), '[[:space:]-]+', '', 'g') = normalized_code
  ) then
    raise exception 'Este código ya está asignado en el registro de códigos adicionales.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_duplicate_primary_product_barcode() from public, anon, authenticated;

drop trigger if exists products_prevent_alternate_barcode_duplicate on public.products;
create trigger products_prevent_alternate_barcode_duplicate
before insert or update of barcode on public.products
for each row execute function public.prevent_duplicate_primary_product_barcode();

create unique index if not exists products_barcode_normalized_unique_idx
on public.products (
  (regexp_replace(upper(barcode), '[[:space:]-]+', '', 'g'))
)
where nullif(regexp_replace(upper(coalesce(barcode, '')), '[[:space:]-]+', '', 'g'), '') is not null;
