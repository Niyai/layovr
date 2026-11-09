-- Venue plans (layovr-plan/1) and the "raise your phone" colour match.

-- Canvas, levels, sections and markers from the venue's plan file.
alter table venues add column plan jsonb;

-- Zones become plan areas: any shape, on a level, in a section.
alter table zones
  add column code text,
  add column section text,
  add column level integer,
  add column kind text not null default 'hall',
  add column shape jsonb,
  add column approximate boolean not null default false,
  add column notes text;

-- Old schematic rectangles were % of a 4:3 box; the plan canvas is 100 × 75 units.
update zones set shape = jsonb_build_object(
  'type', 'rect',
  'x', (rect->>'x')::float,
  'y', (rect->>'y')::float * 0.75,
  'w', (rect->>'w')::float,
  'h', (rect->>'h')::float * 0.75);
update spots set y = y * 0.75;
update zones set code = upper(regexp_replace(id, '^z_', ''));

alter table zones alter column shape set not null;
alter table zones alter column code set not null;
alter table zones drop column rect;
create unique index zones_venue_code on zones(venue_id, code);

-- Colour match: set when the runner reaches the buyer's area.
alter table orders
  add column arrived_at timestamptz,
  add column match_color text,
  add column match_pattern text;
