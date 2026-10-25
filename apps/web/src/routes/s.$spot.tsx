import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { VenuePage } from "@/components/VenuePage";
import { EmptyCard, Section } from "@/components/ui-bits";
import { setSpot, spotByCode, useDB, useHydrated } from "@/lib/store";

/**
 * What every printed QR code points at: /s/<SPOT-CODE>.
 * Remembers the spot for checkout, then shows that venue's vendors.
 */
export const Route = createFileRoute("/s/$spot")({
  head: () => ({ meta: [{ title: "Order to your spot · Layovr" }] }),
  component: SpotRoute,
});

function SpotRoute() {
  const { spot: code } = Route.useParams();
  const d = useDB();
  const hydrated = useHydrated();
  const spot = spotByCode(d, code);
  const venue = spot ? d.venues.find((v) => v.id === spot.venueId) : undefined;

  useEffect(() => {
    if (hydrated && spot) setSpot(spot.id);
  }, [hydrated, spot?.id]);

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
            The card may have moved. Pick your spot from the list instead, or
            ask a Layovr runner.
          </p>
        </EmptyCard>
      </Section>
    );
  }
  return <VenuePage code={venue.code} />;
}
