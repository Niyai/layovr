import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Note, PageHero, Section } from "@/components/ui-bits";
import { useDB } from "@/lib/store";
import type { VenueType } from "@/lib/types";
import { cn, fillClass } from "@/lib/utils";

export const Route = createFileRoute("/explore")({
  head: () => ({ meta: [{ title: "Explore vendors · Layovr" }] }),
  component: Explore,
});

const FILTERS: ("All" | VenueType)[] = [
  "All",
  "Event",
  "Mall",
  "Campus",
  "Neighbourhood",
];

function Explore() {
  const d = useDB();
  const [q, setQ] = useState("");
  const [type, setType] = useState<(typeof FILTERS)[number]>("All");

  const venues = d.venues.filter((v) => {
    const matchesType = type === "All" || v.type === type;
    const needle = q.trim().toLowerCase();
    const matchesQ =
      !needle ||
      [v.name, v.city, v.code].some((s) => s.toLowerCase().includes(needle));
    return matchesType && matchesQ;
  });

  return (
    <>
      <PageHero eyebrow="Explore" title="Where are you right now?">
        Pick your location and we'll show you every vendor serving that spot,
        who's open and what they've got.
      </PageHero>
      <Section>
        <Note>
          🧪 Locations marked "sample" are there so you can try things out. Real
          ones appear as businesses join.
        </Note>
        <div className="mt-8 flex flex-col gap-4 md:flex-row">
          <label className="flex-1">
            <span className="sr-only">Search locations</span>
            <input
              placeholder="Search by place, city or code"
              className="field"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Filter by location type"
          >
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={type === f}
                onClick={() => setType(f)}
                className={cn(
                  "rounded-full border-2 border-ink px-4 py-2 text-sm font-bold",
                  type === f ? "bg-sun shadow-pop" : "bg-card",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {venues.map((v) => {
            const open = d.vendors.filter(
              (x) => x.venueId === v.id && x.isOpen,
            ).length;
            return (
              <Link
                key={v.id}
                to="/l/$code"
                params={{ code: v.code }}
                className={cn(
                  "card-pop p-7 transition hover:-translate-y-1",
                  fillClass[v.fill],
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full border-2 border-ink bg-card px-3 py-0.5 text-xs font-bold">
                    {v.type}
                    {v.isSample && " · sample"}
                  </span>
                  <span className="font-mono text-xs font-bold">{v.code}</span>
                </div>
                <h2 className="mt-4 text-2xl font-extrabold">{v.name}</h2>
                <p className="mt-1">{v.city}</p>
                <p className="mt-4 font-bold">
                  {v.isLive && open > 0
                    ? `${open} vendor${open === 1 ? "" : "s"} serving here →`
                    : "Taking a little break right now"}
                </p>
              </Link>
            );
          })}
          {venues.length === 0 && (
            <p className="text-lg">No places match that search yet.</p>
          )}
        </div>
      </Section>
    </>
  );
}
