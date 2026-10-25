-- Layovr prototype schema. Money is integer kobo everywhere.
-- Every table carries venue_id so one database can serve many venues.
-- The API is the only client of this database, so access rules live in
-- apps/api/src/services (no browser ever talks to Postgres directly).

create table venues (
  id                text primary key,
  code              text not null unique,
  name              text not null,
  city              text not null default '',
  type              text not null default 'Event',
  fill              text not null default 'sun',
  is_live           boolean not null default true,
  is_sample         boolean not null default false,
  fee_pct           double precision not null default 0.04,
  fee_flat_kobo     integer not null default 0 check (fee_flat_kobo >= 0),
  absorb_limit_kobo integer not null default 0 check (absorb_limit_kobo >= 0),
  floor_plan_url    text,
  logo_url          text,
  brand_color       text,
  timezone          text not null default 'Africa/Lagos',
  currency          text not null default 'NGN',
  created_at        timestamptz not null default now()
);

create table zones (
  id         text primary key,
  venue_id   text not null references venues(id) on delete cascade,
  name       text not null,
  restricted boolean not null default false,
  rect       jsonb not null default '{"x":0,"y":0,"w":10,"h":10}',
  sort       integer not null default 0
);
create index zones_venue on zones(venue_id);

create table spots (
  id         text primary key,
  venue_id   text not null references venues(id) on delete cascade,
  zone_id    text not null references zones(id),
  code       text not null unique,
  label      text not null,
  x          double precision not null default 50,
  y          double precision not null default 50,
  landmark   text,
  directions text,
  active     boolean not null default true
);
create index spots_venue on spots(venue_id);

create table vendors (
  id           text primary key,
  venue_id     text not null references venues(id) on delete cascade,
  zone_id      text references zones(id) on delete set null,
  name         text not null,
  emoji        text not null default '🍽️',
  category     text not null default 'Food & drink',
  description  text not null default '',
  stall_label  text not null default '',
  is_open      boolean not null default true,
  prep_minutes integer not null default 8,
  fill         text not null default 'card',
  captured_by  text,
  created_at   timestamptz not null default now()
);
create index vendors_venue on vendors(venue_id);

create table products (
  id               text primary key,
  venue_id         text not null references venues(id) on delete cascade,
  vendor_id        text not null references vendors(id) on delete cascade,
  category         text not null default 'Menu',
  kind             text not null default 'goods' check (kind in ('goods', 'service')),
  name             text not null,
  description      text,
  price_kobo       integer not null check (price_kobo > 0),
  price_checked_at text not null,
  image_url        text,
  in_stock         boolean not null default true,
  fulfilment       text not null default 'deliver'
                   check (fulfilment in ('deliver', 'collect_and_return', 'reserve_slot')),
  duration_min     integer,
  age_restricted   boolean not null default false,
  created_at       timestamptz not null default now()
);
create index products_vendor on products(vendor_id);

create table staff (
  id                   text primary key,
  venue_id             text not null references venues(id) on delete cascade,
  name                 text not null,
  role                 text not null check (role in ('admin', 'dispatch', 'runner', 'capture')),
  phone                text not null default '',
  pin_hash             text not null,
  float_kobo           integer not null default 0,
  can_enter_restricted boolean not null default false,
  on_shift             boolean not null default true
);
create index staff_venue on staff(venue_id);

create table orders (
  id             text primary key,
  venue_id       text not null references venues(id),
  code           text not null unique,
  spot_id        text not null references spots(id),
  runner_id      text references staff(id),
  customer_name  text not null,
  customer_phone text not null,
  customer_email text,
  landmark_note  text,
  subtotal_kobo  integer not null,
  fee_kobo       integer not null,
  refund_kobo    integer not null default 0,
  total_kobo     integer not null,
  status         text not null check (status in (
                   'awaiting_payment', 'paid', 'assigned', 'buying',
                   'on_the_way', 'delivered', 'not_delivered', 'cancelled')),
  eta_at         timestamptz,
  handoff_pin    text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index orders_venue_status on orders(venue_id, status);
create index orders_runner on orders(runner_id);
create index orders_phone on orders(customer_phone);

create table order_stops (
  id            text primary key,
  venue_id      text not null references venues(id),
  order_id      text not null references orders(id) on delete cascade,
  vendor_id     text not null references vendors(id),
  subtotal_kobo integer not null,
  status        text not null default 'pending' check (status in ('pending', 'bought', 'unavailable')),
  sort          integer not null default 0
);
create index order_stops_order on order_stops(order_id);

create table order_items (
  id               text primary key,
  venue_id         text not null references venues(id),
  order_stop_id    text not null references order_stops(id) on delete cascade,
  product_id       text references products(id) on delete set null,
  name_snapshot    text not null,
  unit_price_kobo  integer not null,
  qty              integer not null check (qty > 0),
  status           text not null default 'ok' check (status in ('ok', 'swapped', 'dropped')),
  final_price_kobo integer not null,
  note             text,
  sort             integer not null default 0
);
create index order_items_stop on order_items(order_stop_id);

create table purchases (
  id               text primary key,
  venue_id         text not null references venues(id),
  order_id         text not null references orders(id) on delete cascade,
  order_stop_id    text not null references order_stops(id) on delete cascade,
  runner_id        text not null references staff(id),
  amount_paid_kobo integer not null check (amount_paid_kobo > 0),
  method           text not null check (method in ('cash', 'transfer')),
  receipt_url      text,
  created_at       timestamptz not null default now()
);
create index purchases_runner on purchases(runner_id);

-- One row per payment attempt. tx_ref is what Flutterwave echoes back, so
-- the unique index makes webhook + redirect verification idempotent.
create table payments (
  id                 text primary key,
  venue_id           text not null references venues(id),
  order_id           text not null references orders(id) on delete cascade,
  tx_ref             text not null unique,
  flw_transaction_id text unique,
  mode               text not null check (mode in ('demo', 'flutterwave')),
  amount_kobo        integer not null,
  status             text not null default 'initiated',
  raw                jsonb,
  created_at         timestamptz not null default now()
);
create index payments_order on payments(order_id);

create table order_events (
  id          bigserial primary key,
  venue_id    text not null references venues(id),
  order_id    text not null references orders(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor       text not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index order_events_order on order_events(order_id);

-- Photos (menus, receipts, floor plans), compressed in the browser first.
-- Kept in Postgres so the API stays stateless and easy to host.
create table uploads (
  id           text primary key,
  venue_id     text references venues(id) on delete cascade,
  content_type text not null,
  data         bytea not null,
  created_at   timestamptz not null default now()
);
