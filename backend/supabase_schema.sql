-- 404Hire agentic backend schema.
-- Run this in the Supabase SQL Editor before starting the FastAPI backend.

create extension if not exists pgcrypto;

create table if not exists public.positions (
  id bigint primary key,
  title text not null default '',
  department text not null default '',
  active boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.candidates (
  email text primary key,
  name text not null default '',
  status text not null default '',
  position_id bigint,
  source_type text not null default '',
  source_method text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.applications (
  id text primary key,
  candidate_email text not null references public.candidates(email) on delete cascade,
  position_id bigint references public.positions(id) on delete set null,
  status text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  candidate_email text,
  position_id bigint,
  event_type text not null default 'agent_event',
  node text not null default '',
  message text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  candidate_email text,
  position_id bigint,
  tool_name text not null default '',
  approved boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  candidate_email text,
  position_id bigint,
  to_email text not null default '',
  subject text not null default '',
  sent boolean not null default false,
  autonomous boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.pending_email_verifications (
  email text primary key,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.institution_ranking_cache (
  institution_name text primary key,
  ranking_source text not null default '',
  rank_value integer,
  confidence numeric not null default 0,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_candidates_position_id on public.candidates(position_id);
create index if not exists idx_applications_candidate_email on public.applications(candidate_email);
create index if not exists idx_applications_position_id on public.applications(position_id);
create index if not exists idx_agent_events_candidate_email on public.agent_events(candidate_email);
create index if not exists idx_agent_events_position_id on public.agent_events(position_id);
create index if not exists idx_email_events_candidate_email on public.email_events(candidate_email);

alter table public.positions enable row level security;
alter table public.candidates enable row level security;
alter table public.applications enable row level security;
alter table public.agent_events enable row level security;
alter table public.agent_actions enable row level security;
alter table public.email_events enable row level security;
alter table public.settings enable row level security;
alter table public.pending_email_verifications enable row level security;
alter table public.institution_ranking_cache enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and policyname = 'service_role_all_positions'
  ) then
    create policy service_role_all_positions on public.positions for all to service_role using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and policyname = 'service_role_all_candidates'
  ) then
    create policy service_role_all_candidates on public.candidates for all to service_role using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and policyname = 'service_role_all_applications'
  ) then
    create policy service_role_all_applications on public.applications for all to service_role using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and policyname = 'service_role_all_agent_events'
  ) then
    create policy service_role_all_agent_events on public.agent_events for all to service_role using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and policyname = 'service_role_all_agent_actions'
  ) then
    create policy service_role_all_agent_actions on public.agent_actions for all to service_role using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and policyname = 'service_role_all_email_events'
  ) then
    create policy service_role_all_email_events on public.email_events for all to service_role using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and policyname = 'service_role_all_settings'
  ) then
    create policy service_role_all_settings on public.settings for all to service_role using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and policyname = 'service_role_all_pending_email_verifications'
  ) then
    create policy service_role_all_pending_email_verifications on public.pending_email_verifications for all to service_role using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and policyname = 'service_role_all_ranking_cache'
  ) then
    create policy service_role_all_ranking_cache on public.institution_ranking_cache for all to service_role using (true) with check (true);
  end if;
end
$$;
