-- Visa Didi tables. Prefixed vd_ to stay separate from other apps in the same project.
-- RLS is on with no policies: only the server (service role key) can read or write.

create table public.vd_sources (
  id text primary key,
  destination_id text not null,
  url text not null,
  title text not null,
  authority text not null,
  status text not null check (status in ('ok', 'check_failed', 'unavailable', 'removed')),
  method text check (method in ('fetched', 'manual')),
  content_hash text,
  last_verified date,
  last_attempt date,
  last_error text,
  updated_at timestamptz not null default now()
);

create table public.vd_chunks (
  id text primary key,
  source_id text not null references public.vd_sources(id) on delete cascade,
  destination_id text not null,
  heading text not null default '',
  text text not null,
  -- For a future switch from keyword search to embeddings (PRD: embedding model still to choose).
  embedding extensions.vector(1024)
);
create index vd_chunks_destination_idx on public.vd_chunks (destination_id);
create index vd_chunks_source_idx on public.vd_chunks (source_id);

create table public.vd_change_log (
  id bigint generated always as identity primary key,
  source_id text not null,
  date date not null,
  kind text not null check (kind in ('initial', 'changed', 'fetch_failed', 'removed', 'recovered')),
  note text,
  created_at timestamptz not null default now()
);
create index vd_change_log_source_idx on public.vd_change_log (source_id, date desc);

create table public.vd_answer_cache (
  key text primary key,
  answer jsonb not null,
  created_at timestamptz not null default now()
);

create table public.vd_requests (
  id bigint generated always as identity primary key,
  bucket text not null,
  at timestamptz not null default now()
);
create index vd_requests_bucket_idx on public.vd_requests (bucket, at desc);

create table public.vd_spend (
  month text primary key,
  usd numeric(12, 4) not null default 0,
  updated_at timestamptz not null default now()
);

-- What people ask about and how it ended, without storing the question text.
create table public.vd_question_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  lang text not null,
  destinations text[] not null default '{}',
  topic text,
  kind text not null,
  mode text not null,
  ms integer
);
create index vd_question_log_created_idx on public.vd_question_log (created_at desc);

alter table public.vd_sources enable row level security;
alter table public.vd_chunks enable row level security;
alter table public.vd_change_log enable row level security;
alter table public.vd_answer_cache enable row level security;
alter table public.vd_requests enable row level security;
alter table public.vd_spend enable row level security;
alter table public.vd_question_log enable row level security;

create or replace function public.vd_add_spend(p_month text, p_usd numeric)
returns numeric
language sql
security invoker
set search_path = ''
as $$
  insert into public.vd_spend (month, usd) values (p_month, p_usd)
  on conflict (month) do update set usd = public.vd_spend.usd + excluded.usd, updated_at = now()
  returning usd;
$$;

-- Records a request and returns true if the bucket is still under its limit.
create or replace function public.vd_allow(p_bucket text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recent integer;
begin
  select count(*) into recent from public.vd_requests
    where bucket = p_bucket and at > now() - make_interval(secs => p_window_seconds);
  if recent >= p_max then
    return false;
  end if;
  insert into public.vd_requests (bucket) values (p_bucket);
  delete from public.vd_requests where at < now() - interval '1 day';
  return true;
end;
$$;

revoke all on function public.vd_add_spend(text, numeric) from public, anon, authenticated;
revoke all on function public.vd_allow(text, integer, integer) from public, anon, authenticated;
grant execute on function public.vd_add_spend(text, numeric) to service_role;
grant execute on function public.vd_allow(text, integer, integer) to service_role;
