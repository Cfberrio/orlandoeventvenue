-- Standalone invoices table (not tied to bookings)
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null,
  title text not null,
  description text,
  amount numeric not null check (amount > 0),
  customer_email text not null,
  customer_name text,
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'expired', 'cancelled')),
  stripe_session_id text,
  stripe_payment_intent_id text,
  payment_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- Auto-generate invoice_number via trigger
create or replace function public.generate_invoice_number()
returns trigger as $$
declare
  seq int;
begin
  select count(*) + 1 into seq
  from public.invoices
  where created_at::date = now()::date;

  new.invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(seq::text, 4, '0');
  return new;
end;
$$ language plpgsql;

create trigger trg_invoice_number
  before insert on public.invoices
  for each row
  when (new.invoice_number is null or new.invoice_number = '')
  execute function public.generate_invoice_number();

-- RLS
alter table public.invoices enable row level security;

create policy "Authenticated users can read invoices"
  on public.invoices for select
  to authenticated
  using (true);

create policy "Authenticated users can insert invoices"
  on public.invoices for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update invoices"
  on public.invoices for update
  to authenticated
  using (true);

create policy "Service role full access to invoices"
  on public.invoices for all
  to service_role
  using (true);
