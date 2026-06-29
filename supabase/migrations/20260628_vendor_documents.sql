-- vendor_documents: per-marketing-vendor document storage (agreements, rate sheets,
-- W9s, contracts) — mirrors lender_documents. Applied live via MCP 2026-06-28.
create table if not exists public.vendor_documents (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.marketing_vendors(id) on delete cascade,
  document_type text not null default 'other',
  filename text not null,
  storage_path text not null,
  file_size integer,
  mime_type text,
  status text not null default 'active',
  description text,
  notes text,
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_vendor_documents_vendor on public.vendor_documents(vendor_id);

alter table public.vendor_documents enable row level security;
drop policy if exists "Admins view vendor docs" on public.vendor_documents;
create policy "Admins view vendor docs" on public.vendor_documents for select to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','super_admin')));
drop policy if exists "Admins manage vendor docs" on public.vendor_documents;
create policy "Admins manage vendor docs" on public.vendor_documents for all to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','super_admin')))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','super_admin')));

insert into storage.buckets (id, name, public) values ('vendor-documents','vendor-documents', false)
on conflict (id) do nothing;
-- storage object policies (authenticated) mirror the lender-documents bucket
drop policy if exists "Auth view vendor documents" on storage.objects;
create policy "Auth view vendor documents" on storage.objects for select to authenticated using (bucket_id = 'vendor-documents');
drop policy if exists "Auth upload vendor documents" on storage.objects;
create policy "Auth upload vendor documents" on storage.objects for insert to authenticated with check (bucket_id = 'vendor-documents');
drop policy if exists "Auth update vendor documents" on storage.objects;
create policy "Auth update vendor documents" on storage.objects for update to authenticated using (bucket_id = 'vendor-documents');
drop policy if exists "Auth delete vendor documents" on storage.objects;
create policy "Auth delete vendor documents" on storage.objects for delete to authenticated using (bucket_id = 'vendor-documents');
