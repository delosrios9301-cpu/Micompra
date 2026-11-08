create index if not exists purchase_records_supermarket_id_idx on public.purchase_records(supermarket_id);
create index if not exists purchase_records_branch_id_idx on public.purchase_records(branch_id) where branch_id is not null;
create index if not exists purchase_items_product_id_idx on public.purchase_items(product_id) where product_id is not null;
create index if not exists inventory_adjustments_product_id_idx on public.inventory_adjustments(product_id) where product_id is not null;