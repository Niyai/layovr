-- Live location for buyers (opt-in, per order) and mobile vendors.
-- Same rule as runner_locations: latest position only, no history.

-- A buyer who chose to share where they are so their runner can find them.
-- Deleted when the order is delivered, not delivered or cancelled, or when they stop sharing.
create table buyer_locations (
  order_id    text primary key references orders(id) on delete cascade,
  venue_id    text not null references venues(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  integer not null,
  x           double precision,
  y           double precision,
  level       integer,
  updated_at  timestamptz not null default now()
);

-- Carts and hawkers that move around the venue.
alter table vendors add column mobile boolean not null default false;

-- A mobile vendor's position, shared from a vendor staff phone while the vendor is open.
create table vendor_locations (
  vendor_id   text primary key references vendors(id) on delete cascade,
  venue_id    text not null references venues(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  integer not null,
  x           double precision,
  y           double precision,
  updated_at  timestamptz not null default now()
);

-- Vendor staff: someone working a stall or cart who signs in to share its position.
alter table staff drop constraint staff_role_check;
alter table staff add constraint staff_role_check
  check (role in ('admin', 'dispatch', 'runner', 'capture', 'vendor'));
alter table staff add column vendor_id text references vendors(id) on delete cascade;
