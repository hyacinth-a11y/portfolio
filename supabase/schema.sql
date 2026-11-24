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
      select coalesce(max(number), 0) + 1 into new.number from tickets
        where user_id = new.user_id and board_id is not distinct from new.board_id;
    end if;
    if new.key is null then
      new.key := coalesce(
        (select key_prefix from boards where id = new.board_id),
        (select key_prefix from settings where user_id = new.user_id limit 1),
        'PRJ') || '-' || new.number;
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

-- ---- v4: description templates ----
create table if not exists description_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  body text not null default '',              -- formatted (HTML) description
  work_type text,                              -- if set, used automatically for new tickets of this work type
  created_at timestamptz not null default now()
);

-- ---- v5: priority ----
alter table tickets add column if not exists priority text not null default 'low';  -- low | medium | high | highest

-- ---- v6: multiple boards ----
create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  key_prefix text not null,                    -- e.g. POC -> tickets POC-1, POC-2 ...
  position int not null default 0,
  api_enabled boolean not null default false,  -- shared with other apps through /api/portfolio
  created_at timestamptz not null default now()
);
alter table statuses add column if not exists board_id uuid references boards on delete cascade;
alter table tickets add column if not exists board_id uuid references boards on delete set null;
alter table tickets add column if not exists prev_keys jsonb not null default '[]'::jsonb;  -- old keys after a move / key change
create index if not exists tickets_board on tickets (board_id);

-- first-time upgrade: put everything that exists today on one board called "Projects" (shared with the API)
insert into boards (user_id, name, key_prefix, api_enabled)
  select u.user_id, 'Projects', coalesce((select key_prefix from settings st where st.user_id = u.user_id limit 1), 'PRJ'), true
  from (select user_id from tickets union select user_id from statuses) u
  where not exists (select 1 from boards b where b.user_id = u.user_id);
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'tickets_number') then
    alter table tickets disable trigger tickets_number;  -- don't touch "updated" dates while moving rows onto the board
  end if;
end $$;
update statuses set board_id = (select id from boards b where b.user_id = statuses.user_id order by created_at limit 1) where board_id is null;
update tickets set board_id = (select id from boards b where b.user_id = tickets.user_id order by created_at limit 1) where board_id is null;

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
alter table description_templates enable row level security;
alter table boards enable row level security;

do $$
declare t text;
begin
  foreach t in array array['statuses','fields','tickets','comments','checklist_templates','settings','ticket_links','description_templates','boards'] loop
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
    grant select, insert, update, delete on statuses, fields, tickets, comments, checklist_templates, settings, ticket_links, description_templates, boards to authenticated;
  end if;
end $$;
