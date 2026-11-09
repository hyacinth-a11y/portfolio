-- =========================================================
-- Project Portfolio Board — database setup
-- Paste this whole file into Supabase > SQL Editor > Run.
-- Safe to run again: re-running it upgrades an existing setup without touching your data.
-- =========================================================

create table if not exists statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  color text not null default '#6b778c',
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- Custom field definitions.
-- type: text | textarea | link | date | number | select | multiselect | checkbox
-- options: list of choices for select / multiselect
create table if not exists fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  type text not null,
  options jsonb not null default '[]'::jsonb,
  show_on_card boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  number int,
  title text not null,
  description text not null default '',
  status_id uuid references statuses on delete set null,
  position double precision not null default 0,
  custom jsonb not null default '{}'::jsonb,      -- { field_id: value }
  checklists jsonb not null default '[]'::jsonb,  -- [{id,title,items:[{id,text,done}]}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  ticket_id uuid not null references tickets on delete cascade,
  body text not null,
  author text,
  created_at timestamptz not null default now()
);

create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  items jsonb not null default '[]'::jsonb,       -- ["step 1", "step 2"]
  auto_apply boolean not null default false,      -- add automatically to every new ticket
  created_at timestamptz not null default now()
);

-- ---- v2: work types, hierarchy, issue keys (safe to re-run) ----
create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users on delete cascade,
  key_prefix text not null default 'PRJ',
  created_at timestamptz not null default now()
);
alter table tickets add column if not exists key text;                       -- e.g. POC-71
alter table tickets add column if not exists jira_id text;                   -- Jira "Issue id"
alter table tickets add column if not exists work_type text not null default 'project'; -- workstream | project | subtask
alter table tickets add column if not exists parent_id uuid references tickets on delete set null;
create index if not exists tickets_parent on tickets (parent_id);

-- Auto-number tickets per user and give them a key (PREFIX-NUMBER)
create or replace function set_ticket_number() returns trigger as $$
begin
  if tg_op = 'INSERT' then
    if new.number is null then
      select coalesce(max(number), 0) + 1 into new.number from tickets where user_id = new.user_id;
    end if;
    if new.key is null then
      new.key := coalesce((select key_prefix from settings where user_id = new.user_id limit 1), 'PRJ') || '-' || new.number;
    end if;
  end if;
  new.updated_at := now();
  return new;
end; $$ language plpgsql;

-- ---- v3: linked tickets, editable comments ----
alter table comments add column if not exists edited_at timestamptz;
create table if not exists ticket_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  from_id uuid not null references tickets on delete cascade,
  to_id uuid not null references tickets on delete cascade,
  link_type text not null default 'relates',   -- relates | blocks | duplicates | clones
  created_at timestamptz not null default now()
);
create index if not exists ticket_links_from on ticket_links (from_id);
create index if not exists ticket_links_to on ticket_links (to_id);

-- give older tickets a key
update tickets set key = coalesce((select key_prefix from settings st where st.user_id = tickets.user_id), 'PRJ') || '-' || number
  where key is null and number is not null;

drop trigger if exists tickets_number on tickets;
create trigger tickets_number before insert or update on tickets
  for each row execute function set_ticket_number();

-- Row Level Security: every row is visible only to the user who owns it.
alter table statuses enable row level security;
alter table fields enable row level security;
alter table tickets enable row level security;
alter table comments enable row level security;
alter table checklist_templates enable row level security;
alter table settings enable row level security;
alter table ticket_links enable row level security;

do $$
declare t text;
begin
  foreach t in array array['statuses','fields','tickets','comments','checklist_templates','settings','ticket_links'] loop
    execute format('drop policy if exists "owner_all" on %I', t);
    execute format('create policy "owner_all" on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

create index if not exists tickets_user_status on tickets (user_id, status_id, position);
create index if not exists comments_ticket on comments (ticket_id, created_at);

-- Make sure the logged-in role can use the tables (Supabase usually does this already).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on statuses, fields, tickets, comments, checklist_templates, settings, ticket_links to authenticated;
  end if;
end $$;
