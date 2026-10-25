import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { SpotPicker } from "@/components/SpotPicker";
import { EmptyCard, Note, PageHero, Section } from "@/components/ui-bits";
import {
  runnersFree,
  setSpot,
  useDB,
  useHydrated,
  useSession,
  vendorWait,
} from "@/lib/store";
import { cn, fillClass } from "@/lib/utils";

export function VenuePage({ code }: { code: string }) {
  const d = useDB();
  const session = useSession();
  const hydrated = useHydrated();
  const [picking, setPicking] = useState(false);

  const venue = d.venues.find(
    (v) => v.code.toLowerCase() === code.toLowerCase(),
  );
  if (!venue) {
    return (
      <Section>
        <EmptyCard
          emoji="🧭"
          title="We don't know that place yet"
          action={
            <Link to="/explore" className="btn bg-coral">
              Explore locations
            </Link>
          }
        >
          <p>Check the code on the card, or browse the places Layovr serves.</p>
        </EmptyCard>
      </Section>
    );
  }

  const spot = d.spots.find(
    (s) => s.id === session.spotId && s.venueId === venue.id,
  );
  const zone = spot ? d.zones.find((z) => z.id === spot.zoneId) : undefined;
  const vendors = d.vendors
    .filter((v) => v.venueId === venue.id)
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen));
  const free = runnersFree(d, venue.id);
  const hasSpots = d.spots.some((s) => s.venueId === venue.id);

  return (
    <>
      <PageHero
        eyebrow={`${venue.type} · ${venue.code}`}
        fill={fillClass[venue.fill]}
        title={venue.name}
      >
        <p>{venue.city}</p>
        {hasSpots && (
          <div className="mt-6 rounded-2xl border-2 border-ink bg-card p-4 shadow-pop">
            {spot && !picking ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">
                    Delivering to
                  </div>
                  <div className="text-lg font-extrabold">📍 {spot.label}</div>
                  {zone?.restricted && (
                    <div className="text-sm">
                      Restricted area: a runner with access will bring it.
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm bg-card"
                  onClick={() => setPicking(true)}
                >
                  Change
                </button>
              </div>
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold">
                  Where are you sitting?
                </span>
                <SpotPicker
                  d={d}
                  venueId={venue.id}
                  value={spot?.id}
                  onChange={(id) => {
                    setSpot(id);
                    setPicking(false);
                  }}
                />
                <span className="mt-1 block text-xs">
                  Tip: scanning the code on your seat or table fills this in for
                  you.
                </span>
              </label>
            )}
          </div>
        )}
      </PageHero>

      <Section>
        {venue.isSample && (
          <Note className="mb-8">
            🧪 This is a sample location with sample vendors.
          </Note>
        )}
        {hydrated && venue.isLive && free === 0 && hasSpots && (
          <Note className="mb-8 bg-blush/50">
            All our runners are out right now. You can still order; it may take
            a little longer.
          </Note>
        )}

        {!venue.isLive ? (
          <EmptyCard emoji="😴" title="Taking a little break">
            <p>Vendors here aren't taking orders right now. Check back soon.</p>
          </EmptyCard>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-3xl font-extrabold">Who's serving here</h2>
              <p className="text-sm text-muted-foreground">
                Times include a runner walking it to you.
              </p>
            </div>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {vendors.map((v) => {
                const wait = vendorWait(d, v);
                const count = d.products.filter(
                  (p) => p.vendorId === v.id,
                ).length;
                return (
                  <Link
                    key={v.id}
                    to="/vendor/$vendorId"
                    params={{ vendorId: v.id }}
                    className={cn(
                      "card-pop flex flex-col p-6 transition hover:-translate-y-1",
                      v.isOpen ? fillClass[v.fill] : "bg-muted opacity-75",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid h-14 w-14 place-items-center rounded-full border-2 border-ink bg-card text-3xl">
                        {v.emoji}
                      </div>
                      <span
                        className={cn(
                          "chip",
                          v.isOpen ? "bg-mint" : "bg-muted",
                        )}
                      >
                        {v.isOpen ? "Open" : "Closed"}
                      </span>
                    </div>
                    <h3 className="mt-4 text-xl font-extrabold">{v.name}</h3>
                    <p className="text-sm font-semibold">{v.category}</p>
                    <p className="mt-2 flex-1">{v.description}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-bold">
                      {v.isOpen && (
                        <span className="chip">⏱ ~{wait.minutes} min</span>
                      )}
                      {v.isOpen && wait.busy === "busy" && (
                        <span className="chip bg-blush">Busy</span>
                      )}
                      <span className="chip">{count} items</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </Section>
    </>
  );
}
