import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { RequireStaff } from "@/components/RequireStaff";
import { SeatRequestList } from "@/components/SeatRequests";
import { decideSeatRequest, useDB } from "@/lib/store";
import type { Staff } from "@/lib/types";

export const Route = createFileRoute("/seats")({
  head: () => ({ meta: [{ title: "Seat requests · Layovr" }] }),
  component: () => <RequireStaff roles={["admin", "dispatch"]}>{(me) => <Seats me={me} />}</RequireStaff>,
});

/** On-site admin and dispatch: guests' seat change requests, live. */
function Seats({ me }: { me: Staff }) {
  const d = useDB();
  const venue = d.venues.find((v) => v.id === me.venueId);
  const blocks = venue?.plan?.seating ?? [];
  const waiting = d.seatRequests.filter((r) => r.status === "pending").length;

  return (
    <div className="mx-auto grid max-w-3xl gap-4 px-4 py-6">
      <div>
        <h1 className="text-3xl font-extrabold">Seat requests</h1>
        <p className="text-muted-foreground">
          {venue?.name} · {waiting ? `${waiting} waiting` : "nothing waiting"}
          {venue?.seatChanges === "off" && " · guests can't send requests (turned off in the dashboard)"}
        </p>
      </div>
      {!blocks.length ? (
        <p className="card-pop bg-card p-5">This event has no seating plan. Organisers add seat blocks in the dashboard (Seating tab).</p>
      ) : (
        <SeatRequestList
          requests={d.seatRequests}
          blocks={blocks}
          onDecide={async (id, decision, to, note) => {
            const ok = await decideSeatRequest(id, decision, to, note);
            if (ok) toast.success(decision === "approve" ? "Moved. The guest sees their new seat." : "Declined");
            return ok;
          }}
        />
      )}
    </div>
  );
}
