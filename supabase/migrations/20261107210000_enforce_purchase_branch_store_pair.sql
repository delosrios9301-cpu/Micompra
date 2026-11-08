alter table public.purchase_records
  add constraint purchase_records_branch_store_fkey
  foreign key (branch_id, supermarket_id)
  references public.supermarket_branches(id, supermarket_id);