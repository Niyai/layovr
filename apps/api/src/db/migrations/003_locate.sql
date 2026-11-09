-- Finding the buyer without a QR scan, and runner live location.

-- How the buyer said where they are (qr, map, gps, list) and, for map/gps, the exact point.
alter table orders
  add column locate_method text,
  add column pin_x double precision,
  add column pin_y double precision,
  add column pin_level integer,
  add column pin_accuracy_m integer;

-- A runner's last position while they have an active order. One row per runner,
-- deleted when they have no active orders or sign out: no location history is kept.
create table runner_locations (
  runner_id   text primary key references staff(id) on delete cascade,
  venue_id    text not null references venues(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  integer not null,
  x           double precision,
  y           double precision,
  updated_at  timestamptz not null default now()
);
