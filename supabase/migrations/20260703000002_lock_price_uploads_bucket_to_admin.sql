drop policy if exists insert_price_uploads on storage.objects;
drop policy if exists read_price_uploads on storage.objects;
drop policy if exists update_price_uploads on storage.objects;

create policy price_uploads_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'price_uploads' and public.is_admin());
create policy price_uploads_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'price_uploads' and public.is_admin());
create policy price_uploads_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'price_uploads' and public.is_admin())
  with check (bucket_id = 'price_uploads' and public.is_admin());
