import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RequirePartner } from "@/components/DashboardChrome";
import { papi, refresh, useRunnerRequests } from "@/lib/partnerApi";
import { cn } from "@/lib/utils";
import { eventDates } from "./dashboard.index";

export const Route = createFileRoute("/dashboard/operator")({
  head: () => ({ meta: [{ title: "Runner requests · Layovr operators" }] }),
  component: () => (
    <RequirePartner>
      {(me) => (me.user.role === "operator" ? <Requests /> : <p className="p-8">Layovr operators only.</p>)}
    </RequirePartner>
  ),
});

function Requests() {
  const reqs = useRunnerRequests();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const decide = async (id: string, decision: "approve" | "decline") => {
    try {
      await papi(`/operator/events/${id}/runner-request`, { body: { decision, ...(notes[id]?.trim() ? { note: notes[id]!.trim() } : {}) } });
      await refresh(["runner-requests"], ["events"]);
      toast.success(decision === "approve" ? "Approved. Add the runners from the event's Staff tab." : "Declined");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-3xl font-extrabold">Runner requests</h1>
      <p className="text-muted-foreground">Events asking Layovr to handle deliveries.</p>
      {reqs.data?.length === 0 && <p className="mt-6">No requests.</p>}
      <ul className="mt-6 grid gap-4">
        {reqs.data?.map((e) => (
          <li key={e.id} className={cn("card-pop grid gap-3 p-5", e.runnerRequest.status === "requested" ? "bg-sun" : "bg-card")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-xl font-extrabold">{e.name}</h2>
                <p className="text-sm">
                  {e.partnerName} · {eventDates(e)} · {e.address ?? "no location"}
                </p>
              </div>
              <span className="chip bg-card">{e.runnerRequest.status}</span>
            </div>
            <p>
              <b>{e.runnerRequest.runnersNeeded ?? "?"} runners</b>
              {e.runnerRequest.note && <> · “{e.runnerRequest.note}”</>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="field max-w-md flex-1 py-1.5"
                placeholder="Reply to the organiser (optional)"
                value={notes[e.id] ?? ""}
                onChange={(x) => setNotes({ ...notes, [e.id]: x.target.value })}
              />
              <button type="button" className="btn btn-sm bg-mint" onClick={() => void decide(e.id, "approve")}>
                Approve
              </button>
              <button type="button" className="btn btn-sm bg-blush" onClick={() => void decide(e.id, "decline")}>
                Decline
              </button>
              <Link to="/dashboard/events/$eventId" params={{ eventId: e.id }} search={{ tab: "staff" }} className="btn btn-sm bg-card">
                Add Layovr runners
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
