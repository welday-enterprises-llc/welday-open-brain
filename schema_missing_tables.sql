-- ============================================================
-- WELDAY OPEN BRAIN — Missing 7 Tables
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Venture health snapshots (daily readiness tracking)
create table venture_health_snapshots (
  id              uuid primary key default gen_random_uuid(),
  venture_id      uuid not null references ventures(id) on delete cascade,
  snapshot_date   date not null default current_date,
  readiness_score integer default 0,
  risk_level      text default 'medium',
  monthly_revenue_usd numeric(10,2) default 0,
  notes           text,
  created_at      timestamptz default now(),
  unique(venture_id, snapshot_date)
);

-- 2. Calendar events
create table calendar_events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  start_at      timestamptz not null,
  end_at        timestamptz,
  all_day       boolean default false,
  location      text,
  venture_id    uuid references ventures(id),
  source        text default 'manual',
  external_id   text,
  tags          text[],
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 3. Contacts
create table contacts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text,
  phone         text,
  company       text,
  role          text,
  venture_id    uuid references ventures(id),
  relationship  text default 'contact',
  notes         text,
  tags          text[],
  last_contact  date,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 4. Financial entries
create table financial_entries (
  id            uuid primary key default gen_random_uuid(),
  venture_id    uuid references ventures(id),
  type          text not null,
  amount        numeric(12,2) not null,
  currency      text default 'USD',
  description   text,
  category      text,
  entry_date    date not null default current_date,
  recurring     boolean default false,
  recurring_interval text,
  tags          text[],
  created_at    timestamptz default now()
);

-- 5. Saved dashboards
create table saved_dashboards (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  query         text,
  layout        jsonb default '[]',
  is_default    boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 6. Schema changelog (GTD filer proposes schema changes here)
create table schema_changelog (
  id            uuid primary key default gen_random_uuid(),
  proposed_by   text default 'gtd_filer',
  table_name    text,
  change_type   text,
  description   text not null,
  sql_snippet   text,
  status        text default 'proposed',
  created_at    timestamptz default now()
);

-- 7. Agent logs
create table agent_logs (
  id              uuid primary key default gen_random_uuid(),
  agent_name      text not null,
  action          text not null,
  input_summary   text,
  output_summary  text,
  tables_read     text[],
  tables_written  text[],
  duration_ms     integer,
  tokens_used     integer,
  model_used      text,
  success         boolean default true,
  error_message   text,
  created_at      timestamptz default now()
);

-- Indexes
create index idx_venture_snapshots_date  on venture_health_snapshots(venture_id, snapshot_date desc);
create index idx_calendar_events_start   on calendar_events(start_at, end_at);
create index idx_agent_logs_created      on agent_logs(agent_name, created_at desc);
create index idx_financial_entries_date  on financial_entries(venture_id, entry_date desc);

-- updated_at triggers
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger set_updated_at_calendar_events    before update on calendar_events    for each row execute function set_updated_at();
create trigger set_updated_at_contacts           before update on contacts           for each row execute function set_updated_at();
create trigger set_updated_at_saved_dashboards   before update on saved_dashboards   for each row execute function set_updated_at();

-- RLS
alter table venture_health_snapshots enable row level security;
alter table calendar_events          enable row level security;
alter table contacts                 enable row level security;
alter table financial_entries        enable row level security;
alter table saved_dashboards         enable row level security;
alter table schema_changelog         enable row level security;
alter table agent_logs               enable row level security;

-- Read policies (authenticated users)
create policy "auth read venture_health_snapshots" on venture_health_snapshots for select to authenticated using (true);
create policy "auth read calendar_events"          on calendar_events          for select to authenticated using (true);
create policy "auth read contacts"                 on contacts                 for select to authenticated using (true);
create policy "auth read financial_entries"        on financial_entries        for select to authenticated using (true);
create policy "auth read saved_dashboards"         on saved_dashboards         for select to authenticated using (true);
create policy "auth read schema_changelog"         on schema_changelog         for select to authenticated using (true);
create policy "auth read agent_logs"               on agent_logs               for select to authenticated using (true);

-- Write policies (authenticated users)
create policy "auth write calendar_events"     on calendar_events     for insert to authenticated with check (true);
create policy "auth write contacts"            on contacts            for insert to authenticated with check (true);
create policy "auth write financial_entries"   on financial_entries   for insert to authenticated with check (true);
create policy "auth write saved_dashboards"    on saved_dashboards    for insert to authenticated with check (true);
create policy "auth update saved_dashboards"   on saved_dashboards    for update to authenticated using (true);
create policy "auth update contacts"           on contacts            for update to authenticated using (true);
create policy "auth update calendar_events"    on calendar_events     for update to authenticated using (true);

-- Service role full access (for agents writing logs, snapshots etc)
create policy "service role agent_logs"               on agent_logs               for all to service_role using (true);
create policy "service role venture_health_snapshots" on venture_health_snapshots for all to service_role using (true);
create policy "service role schema_changelog"         on schema_changelog         for all to service_role using (true);
create policy "service role financial_entries"        on financial_entries        for all to service_role using (true);
