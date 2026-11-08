-- Restrict product creation to the first authorized price reviewer (primary administrator).
grant insert on table public.products to authenticated;

drop policy if exists "First price reviewer can add products" on public.products;
create policy "First price reviewer can add products"
on public.products
for insert
to authenticated
with check ((select public.is_price_reviewer()) and active = true);

-- Case/whitespace-insensitive uniqueness across name, brand and package.
create unique index if not exists products_catalog_identity_unique_idx
on public.products (
  lower(trim(canonical_name)),
  coalesce(lower(trim(brand)), ''),
  coalesce(normalized_quantity, -1::numeric),
  coalesce(lower(trim(normalized_unit_name)), '')
);
