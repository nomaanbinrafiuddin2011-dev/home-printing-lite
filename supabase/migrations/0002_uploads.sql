-- Customer uploads. The browser never reads this table; only the server (service role) and admins do.
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null default 'application/pdf',
  size_bytes bigint not null,
  pages integer check (pages > 0),
  sha256 text,
  token_hash text not null,                      -- SHA-256 of the secret only the uploader holds
  status text not null default 'pending' check (status in ('pending','ready')),
  claimed_order_id uuid,                          -- set atomically when an order uses this file
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index uploads_unclaimed_expiry_idx on public.uploads (expires_at) where claimed_order_id is null;
alter table public.uploads enable row level security;
create policy "admin read uploads" on public.uploads for select using (public.is_admin());
-- No other policies: anon/authenticated customers cannot read or write uploads directly.

-- Enforce limits at the storage layer too (25 MB, PDF only).
update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['application/pdf'] where id = 'documents';
