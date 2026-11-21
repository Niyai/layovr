import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { fitGeo } from "@layovr/shared";
import { FloorPlan, type PlanDot } from "@/components/FloorPlan";
import { LocateMe } from "@/components/LocateMe";
import { EmptyCard, Note, PageHero, Section } from "@/components/ui-bits";
import {
  runnersFree,
  setSpot,
  useDB,
  useHydrated,
  useSession,
  vendorWait,
} from "@/lib/store";
import { directionsUrl } from "@/lib/google";
import { vendorDots } from "@/lib/liveDots";
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
  const fit = venue.plan?.canvas.geo ? fitGeo(venue.plan.canvas.geo.points) : null;
  const centre = fit && venue.plan ? fit.toGeo(venue.plan.canvas.width / 2, venue.plan.canvas.height / 2) : null;
  // Carts and hawkers sharing where they are, with roughly how far from the buyer's chosen point.
  const carts = vendorDots(d, venue.id);
  const from = session.pinpoint?.x !== undefined && session.pinpoint.y !== undefined ? session.pinpoint : spot;
  const cartDistance = (dot: PlanDot) =>
    fit && from?.x !== undefined && from.y !== undefined
      ? Math.max(10, Math.round((Math.hypot(dot.x - from.x, dot.y - from.y) * fit.metresPerUnit) / 10) * 10)
      : null;

  return (
    <>
      <PageHero
        eyebrow={`${venue.type} · ${venue.code}`}
        fill={fillClass[venue.fill]}
        title={venue.name}
      >
        <p>
          {venue.city}
          {centre && (
            <>
              {" · "}
              <a className="font-bold underline" href={directionsUrl(centre[0], centre[1])} target="_blank" rel="noreferrer">
                Directions
              </a>
            </>
          )}
        </p>
        {(venue.plan?.seating?.length ?? 0) > 0 && (
          <Link to="/seat" search={{ event: venue.code }} className="btn mt-4 bg-card py-2 text-sm">
            🎟️ Find my seat
          </Link>
        )}
        {hasSpots && (
          <div className="mt-6 rounded-2xl border-2 border-ink bg-card p-4 shadow-pop">
            {spot && !picking ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">
                    Delivering to
                  </div>
                  <div className="text-lg font-extrabold">📍 {spot.label}</div>
                  {session.pinpoint && session.pinpoint.method !== "qr" && (
                    <div className="text-xs">
                      {session.pinpoint.method === "map"
                        ? "From where you tapped on the map"
                        : session.pinpoint.method === "gps"
                          ? `From your location (±${session.pinpoint.accuracyM} m)`
                          : session.pinpoint.method === "seat"
                            ? `To your seat: ${session.seatNote ?? "from your ticket"}`
                            : "Chosen from the list"}
                    </div>
                  )}
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
              <div>
                <span className="mb-2 block text-sm font-bold">
                  Where are you? No code needed.
                </span>
                <LocateMe
                  d={d}
                  venue={venue}
                  value={spot?.id}
                  onPick={(id, pinpoint) => {
                    setSpot(id, pinpoint);
                    setPicking(false);
                  }}
                />
                <span className="mt-2 block text-xs">
                  Or scan the code on your seat or table to fill this in.
                </span>
              </div>
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
            {carts.length > 0 && (
              <section className="mb-10 grid gap-4 md:grid-cols-[1fr_1fr]">
                <div>
                  <h2 className="text-2xl font-extrabold">On the move near you</h2>
                  <ul className="mt-3 grid gap-2">
                    {carts.map((dot) => {
                      const m = cartDistance(dot);
                      return (
                        <li key={dot.id} className="rounded-2xl border-2 border-ink bg-card px-3 py-2 font-semibold">
                          {dot.icon} {dot.label}
                          {m !== null && <span className="font-normal"> · about {m} m from you</span>}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-sm text-muted-foreground">Carts share where they are while they're open. Order as usual and a runner brings it.</p>
                </div>
                <FloorPlan
                  venue={venue}
                  zones={d.zones.filter((z) => z.venueId === venue.id)}
                  spots={[]}
                  dots={carts}
                  {...(from?.x !== undefined && from.y !== undefined ? { pin: { x: from.x, y: from.y } } : {})}
                />
              </section>
            )}
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
                      {v.mobile && <span className="chip bg-sun">🛒 On the move</span>}
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
