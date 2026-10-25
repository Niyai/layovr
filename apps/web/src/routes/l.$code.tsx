import { createFileRoute } from "@tanstack/react-router";
import { VenuePage } from "@/components/VenuePage";

export const Route = createFileRoute("/l/$code")({
  head: ({ params }) => ({ meta: [{ title: `${params.code} · Layovr` }] }),
  component: VenueRoute,
});

function VenueRoute() {
  const { code } = Route.useParams();
  return <VenuePage code={code} />;
}
