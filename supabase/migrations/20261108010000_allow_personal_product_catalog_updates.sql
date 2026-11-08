drop policy if exists "First price reviewer can update products" on public.products;
create policy "First price reviewer can update products"
on public.products
for update
to authenticated
using ((select public.is_price_reviewer()))
with check ((select public.is_price_reviewer()));

grant update (
  canonical_name,
  brand,
  category,
  normalized_quantity,
  normalized_unit,
  normalized_unit_name,
  barcode,
  active
) on public.products to authenticated;