-- Permit only the primary price reviewer to add exact supermarket product mappings.
-- Mapping rows require a source SKU and exact package description; price observations remain separately reviewed.
grant insert on public.store_products to authenticated;

drop policy if exists "Only primary reviewer can create store product mappings" on public.store_products;
create policy "Only primary reviewer can create store product mappings"
on public.store_products
for insert
to authenticated
with check (
  public.is_price_reviewer()
  and nullif(btrim(source_sku), '') is not null
  and nullif(btrim(source_product_name), '') is not null
  and nullif(btrim(package_description), '') is not null
  and source_product_url ~ '^https://'
  and exists (
    select 1 from public.products p
    where p.id = store_products.product_id and p.active = true
  )
  and exists (
    select 1 from public.supermarkets s
    where s.id = store_products.supermarket_id and s.active = true
  )
  and (
    store_products.branch_id is null
    or exists (
      select 1 from public.supermarket_branches b
      where b.id = store_products.branch_id
        and b.supermarket_id = store_products.supermarket_id
        and b.active = true
    )
  )
);
