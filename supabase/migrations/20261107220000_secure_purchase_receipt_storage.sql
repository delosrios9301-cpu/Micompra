insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'purchase-receipts',
  'purchase-receipts',
  false,
  8388608,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do nothing;

alter table public.purchase_records
  add column if not exists receipt_path text null;

create policy "Users upload own purchase receipts"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'purchase-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users read own purchase receipts"
on storage.objects for select to authenticated
using (
  bucket_id = 'purchase-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users update own purchase receipts"
on storage.objects for update to authenticated
using (
  bucket_id = 'purchase-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'purchase-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users delete own purchase receipts"
on storage.objects for delete to authenticated
using (
  bucket_id = 'purchase-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);