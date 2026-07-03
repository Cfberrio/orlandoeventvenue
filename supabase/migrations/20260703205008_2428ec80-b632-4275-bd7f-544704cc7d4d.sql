create table if not exists public.gmail_draft_log (
  id uuid primary key default gen_random_uuid(),
  brand_code text not null,
  event_id text,
  gmail_message_id text not null unique,
  gmail_thread_id text,
  from_email text,
  subject text,
  snippet text,
  decision text not null default 'processing',
  skip_reason text,
  score numeric,
  audience text,
  reasoning text,
  draft_id text,
  draft_message_id text,
  draft_body text,
  prompt_version text,
  model text,
  input_tokens integer,
  output_tokens integer,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gmail_draft_log_created_idx on public.gmail_draft_log (created_at desc);
create index if not exists gmail_draft_log_decision_idx on public.gmail_draft_log (decision);
grant all on public.gmail_draft_log to service_role;
alter table public.gmail_draft_log enable row level security;