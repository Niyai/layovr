import { createFileRoute } from "@tanstack/react-router";
import { SpotLanding } from "@/components/SpotLanding";
import { useDB } from "@/lib/store";

/**
 * Older QR cards: /s/<SPOT-CODE> without the event. Works when the code is
 * unique among live events; otherwise asks which event. New cards use /e/<EVENT>/<SPOT>.
 */
export const Route = createFileRoute("/s/$spot")({
  head: () => ({ meta: [{ title: "Order to your spot · Layovr" }] }),
  component: LegacySpotRoute,
});

function LegacySpotRoute() {
  const { spot: code } = Route.useParams();
  const d = useDB();
  const matches = d.spots
    .filter((s) => s.active && s.code.toLowerCase() === code.toLowerCase())
    .flatMap((spot) => {
      const venue = d.venues.find((v) => v.id === spot.venueId);
      return venue ? [{ venue, spot }] : [];
    });
  return <SpotLanding venue={matches[0]?.venue} spot={matches[0]?.spot} matches={matches} />;
}
