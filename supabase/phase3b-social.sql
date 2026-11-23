-- Phase 3B public creator profile, follow graph, referrals.
create extension if not exists pgcrypto;
create table if not exists public.app_profiles (
 session_token_hash text primary key,
 slug text unique not null,
 display_name text not null,
 bio text not null default '',
 avatar_url text,
 cover_url text,
 social_links jsonb not null default '[]'::jsonb,
 verified boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.app_follows (
 follower_hash text not null,
 followed_hash text not null,
 created_at timestamptz not null default now(),
 primary key (follower_hash, followed_hash),
 check (follower_hash <> followed_hash)
);
create table if not exists public.app_referrals (
 referrer_hash text primary key,
 code text unique not null,
 signups integer not null default 0,
 conversions integer not null default 0,
 created_at timestamptz not null default now()
);
create table if not exists public.app_referral_events (
 referred_hash text primary key,
 referrer_hash text not null,
 created_at timestamptz not null default now(),
 converted_at timestamptz
);
alter table public.app_profiles enable row level security;
alter table public.app_follows enable row level security;
alter table public.app_referrals enable row level security;
alter table public.app_referral_events enable row level security;
-- No direct browser policies. Reads/writes go through the private server integration.
