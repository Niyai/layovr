-- Seated events: tickets with a seat, friend groups and seat change requests.
-- Seat blocks themselves live in the venue plan (venues.plan -> seating).

-- off = guests can't ask; review = organisers decide; auto = a free seat with the same ticket type is approved at once.
alter table venues add column seat_changes text not null default 'review'
  check (seat_changes in ('off', 'review', 'auto'));

-- Friends at an event who chose to see each other: joined by a link, no contacts needed.
create table ticket_groups (
  id          text primary key,
  venue_id    text not null references venues(id) on delete cascade,
  code        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Imported from the organiser's ticketing system. The id is unguessable and is
-- what a guest's phone keeps; the ticket number is only used to look it up.
create table tickets (
  id             text primary key,
  venue_id       text not null references venues(id) on delete cascade,
  ticket_number  text not null,
  barcode        text,
  holder_name    text not null default '',
  tier           text,
  block          text not null,
  row_label      text not null,
  seat_number    integer not null,
  checked_in_at  timestamptz,
  gate           text,
  group_id       text references ticket_groups(id) on delete set null,
  share_seat     boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint tickets_number_key unique (venue_id, ticket_number),
  -- Deferred so an import (or approval) can swap two seats in one transaction.
  constraint tickets_seat_key unique (venue_id, block, row_label, seat_number) deferrable initially deferred
);
create unique index tickets_barcode on tickets(venue_id, barcode) where barcode is not null;
create index tickets_group on tickets(group_id);

create table seat_requests (
  id             text primary key,
  venue_id       text not null references venues(id) on delete cascade,
  ticket_id      text not null references tickets(id) on delete cascade,
  want           text not null check (want in ('seat', 'block', 'friends')),
  want_block     text,
  want_row       text,
  want_seat      integer,
  note           text,
  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'declined', 'cancelled')),
  from_seat      jsonb not null,
  to_seat        jsonb,
  decided_by     text,
  decision_note  text,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);
create index seat_requests_venue on seat_requests(venue_id, status);
create index seat_requests_ticket on seat_requests(ticket_id);
