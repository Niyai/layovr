-- Partners (event planners, venues, platforms) set up their own events.
-- An event is a venues row with its own plan, vendors, staff and orders.

create table partners (
  id         text primary key,
  name       text not null,
  slug       text not null unique,
  kind       text not null default 'event_planner'
             check (kind in ('event_planner', 'venue', 'ticketing', 'airport', 'layovr', 'other')),
  phone      text,
  created_at timestamptz not null default now()
);

create table partner_users (
  id            text primary key,
  partner_id    text not null references partners(id) on delete cascade,
  email         text not null unique,
  name          text not null,
  password_hash text not null,
  -- operator = Layovr's own team (approves runner requests, sees every event)
  role          text not null default 'owner' check (role in ('owner', 'manager', 'operator')),
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);
create index partner_users_partner on partner_users(partner_id);

alter table venues
  add column partner_id text references partners(id) on delete set null,
  add column status text not null default 'live' check (status in ('draft', 'live', 'ended')),
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column address text,
  add column lat double precision,
  add column lng double precision,
  add column google_place_id text,
  add column template_code text,
  add column delivery_mode text not null default 'own_runners'
             check (delivery_mode in ('own_runners', 'layovr_runners')),
  add column runner_request_status text not null default 'none'
             check (runner_request_status in ('none', 'requested', 'approved', 'declined')),
  add column runners_needed integer,
  add column runner_request_note text,
  add column runner_request_reply text;
create index venues_partner on venues(partner_id);

alter table staff add column provided_by text not null default 'partner'
  check (provided_by in ('partner', 'layovr'));

alter table vendors
  add column contact_name text,
  add column contact_phone text;

-- Single-use links that let a vendor fill in their own stall and menu.
create table invites (
  id         text primary key,
  venue_id   text not null references venues(id) on delete cascade,
  vendor_id  text not null references vendors(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Partner API keys (headless API and MCP). Only a hash is stored.
create table api_keys (
  id           text primary key,
  partner_id   text not null references partners(id) on delete cascade,
  name         text not null,
  prefix       text not null,
  key_hash     text not null unique,
  scope        text not null default 'write' check (scope in ('read', 'write')),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index api_keys_partner on api_keys(partner_id);

-- Every write through an API key or MCP: who, what, and whether it worked.
create table api_audit (
  id         bigserial primary key,
  partner_id text not null,
  key_id     text,
  user_id    text,
  channel    text not null check (channel in ('api', 'mcp', 'dashboard')),
  action     text not null,
  target     text,
  ok         boolean not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index api_audit_partner on api_audit(partner_id, created_at);

-- Spot codes are unique per event (many events start from the same venue
-- template), so QR links carry the event code: /e/<EVENT>/<SPOT>.
alter table spots drop constraint spots_code_key;
create unique index spots_venue_code on spots(venue_id, code);
