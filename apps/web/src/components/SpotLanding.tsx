import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { VenuePage } from "@/components/VenuePage";
import { EmptyCard, Section } from "@/components/ui-bits";
import { setSpot, useHydrated } from "@/lib/store";
import type { Spot, Venue } from "@/lib/types";

/**
 * What a printed QR opens: remembers the spot for checkout, then shows the
 * event's vendors. `matches` > 1 means a bare spot code exists at several events.
 */
export function SpotLanding({
  venue,
  spot,
  matches = [],
}: {
  venue: Venue | undefined;
  spot: Spot | undefined;
  matches?: { venue: Venue; spot: Spot }[];
}) {
  const hydrated = useHydrated();

  useEffect(() => {
    if (hydrated && spot) setSpot(spot.id, { method: "qr" });
  }, [hydrated, spot?.id]);

  if (matches.length > 1) {
    return (
      <Section>
        <EmptyCard emoji="🎟️" title="Which event are you at?">
          <ul className="mt-4 grid gap-2 text-left">
            {matches.map((m) => (
              <li key={m.spot.id}>
                <Link
                  to="/e/$event/$spot"
                  params={{ event: m.venue.code, spot: m.spot.code }}
                  className="btn w-full bg-card"
                >
                  {m.venue.name} · {m.spot.label}
                </Link>
              </li>
            ))}
          </ul>
        </EmptyCard>
      </Section>
    );
  }

  if (!spot || !venue) {
    return (
      <Section>
        <EmptyCard
          emoji="🔎"
          title="That code isn't active"
          action={
            <Link to="/scan" className="btn bg-coral">
              Try another code
            </Link>
          }
        >
          <p>
            The card may have moved. Pick your spot on the map instead, or ask a
            Layovr runner.
          </p>
        </EmptyCard>
      </Section>
    );
  }
  return <VenuePage code={venue.code} />;
}
