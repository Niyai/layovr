import { createFileRoute } from "@tanstack/react-router";
import { SpotLanding } from "@/components/SpotLanding";
import { spotByCode, useDB, venueByCode } from "@/lib/store";

/** What every printed QR code points at: /e/<EVENT-CODE>/<SPOT-CODE>. */
export const Route = createFileRoute("/e/$event/$spot")({
  head: () => ({ meta: [{ title: "Order to your spot · Layovr" }] }),
  component: EventSpotRoute,
});

function EventSpotRoute() {
  const { event, spot: code } = Route.useParams();
  const d = useDB();
  const venue = venueByCode(d, event);
  const spot = venue ? spotByCode(d, code, venue.id) : undefined;
  return <SpotLanding venue={venue} spot={spot} />;
}
