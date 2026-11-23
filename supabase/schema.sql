-- Run in Supabase SQL Editor before deploying. Server uses service-role key only; never expose it in browser code.
create extension if not exists pgcrypto;
create table if not exists public.app_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  credits bigint not null default 50 check (credits >= 0),
  plan text not null default 'Free',
  created_at timestamptz not null default now(),
  kyc_status text not null default 'not_started'
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text not null references public.app_sessions(token_hash),
  network text not null,
  txid text not null,
  plan_id text not null,
  expected_amount text,
  status text not null default 'pending_review' check (status in ('pending_review','verified','credited','rejected')),
  confirmations integer not null default 0,
  review_reason text,
  created_at timestamptz not null default now(),
  unique (network, txid)
);
create table if not exists public.media_jobs (
  id uuid primary key default gen_random_uuid(),
  session_token_hash text not null references public.app_sessions(token_hash),
  kind text not null,
  status text not null,
  output_url text,
  error_message text,
  created_at timestamptz not null default now()
);
create table if not exists public.kyc_records (
  session_token_hash text primary key references public.app_sessions(token_hash),
  provider_session_id text unique not null,
  status text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_sessions enable row level security;
alter table public.payments enable row level security;
alter table public.media_jobs enable row level security;
alter table public.kyc_records enable row level security;
-- No public policies: all access is mediated by the server's service-role client.
create or replace function public.confirm_payment_and_credit(p_payment_id uuid, p_credits bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare target_hash text; affected integer;
begin
  if p_credits <= 0 or p_credits > 1000000 then raise exception 'invalid credit grant'; end if;
  update public.payments set status='credited', review_reason=null
    where id=p_payment_id and status='verified' returning session_token_hash into target_hash;
  get diagnostics affected = row_count;
  if affected = 0 then return false; end if;
  update public.app_sessions set credits=credits+p_credits where token_hash=target_hash;
  if not found then raise exception 'session not found'; end if;
  return true;
end; $$;
revoke all on function public.confirm_payment_and_credit(uuid,bigint) from public, anon, authenticated;
grant execute on function public.confirm_payment_and_credit(uuid,bigint) to service_role;
