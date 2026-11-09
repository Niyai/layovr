import { distanceM, type VenuePlanInput } from "@layovr/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RequirePartner } from "@/components/DashboardChrome";
import { PlaceSearch, type PickedPlace } from "@/components/PlaceSearch";
import { PlanPreview } from "@/components/PlanPreview";
import { Field } from "@/components/ui-bits";
import { papi, refresh, useTemplates, type EventDetail, type VenueTemplate } from "@/lib/partnerApi";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/events/new")({
  head: () => ({ meta: [{ title: "New event · Layovr partners" }] }),
  component: () => <RequirePartner>{() => <NewEvent />}</RequirePartner>,
});

const STEPS = ["Event", "Location", "Venue plan", "Deliveries", "Review"] as const;

type PlanStart = { kind: "template"; code: string } | { kind: "upload"; name: string; plan: unknown } | { kind: "blank" };

const QUALITY: Record<VenueTemplate["dataQuality"], string> = {
  measured: "Published dimensions",
  estimated: "Estimated from capacity",
  schematic: "Drawn from venue signage",
};

function NewEvent() {
  const navigate = useNavigate();
  const templates = useTemplates();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const [start, setStart] = useState<PlanStart>({ kind: "blank" });
  const [mode, setMode] = useState<"own_runners" | "layovr_runners">("own_runners");
  const [runnersNeeded, setRunnersNeeded] = useState(4);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ["template", start.kind === "template" ? start.code : null],
    queryFn: () => papi<VenueTemplate & { plan: VenuePlanInput }>(`/venue-templates/${start.kind === "template" ? start.code : ""}`),
    enabled: start.kind === "template",
    staleTime: Infinity,
  });

  // Venues near the chosen location first.
  const sorted = [...(templates.data ?? [])].sort((a, b) => {
    const d = (t: VenueTemplate) => (place && t.lat !== undefined && t.lng !== undefined ? distanceM(place.lat, place.lng, t.lat, t.lng) : Infinity);
    return a.kind === b.kind ? d(a) - d(b) : a.kind === "venue" ? -1 : 1;
  });

  const canNext = [name.trim().length >= 3 && (!endsAt || !startsAt || endsAt >= startsAt), true, true, mode === "own_runners" || runnersNeeded > 0, true][step];

  const create = async () => {
    setBusy(true);
    try {
      const e = await papi<EventDetail>("/partner/events", {
        body: {
          name: name.trim(),
          ...(code.trim() ? { code: code.trim().toUpperCase() } : {}),
          ...(startsAt ? { startsAt: new Date(startsAt).toISOString() } : {}),
          ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
          ...(place ? { location: place } : {}),
          ...(start.kind === "template" ? { templateCode: start.code } : {}),
          ...(start.kind === "upload" ? { plan: start.plan } : {}),
          deliveryMode: mode,
          ...(mode === "layovr_runners" ? { runnersNeeded, ...(note.trim() ? { runnerRequestNote: note.trim() } : {}) } : {}),
        },
      });
      await refresh(["events"]);
      toast.success(`${e.name} created as a draft`);
      void navigate({ to: "/dashboard/events/$eventId", params: { eventId: e.id }, search: { tab: "plan" } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const chosenTemplate = start.kind === "template" ? templates.data?.find((t) => t.code === start.code) : undefined;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-3xl font-extrabold">New event</h1>
      <ol className="mt-4 flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={i > step}
              onClick={() => setStep(i)}
              className={cn(
                "rounded-full border-2 border-ink px-3 py-1 text-sm font-bold",
                i === step ? "bg-sun" : i < step ? "bg-mint" : "bg-card opacity-60",
              )}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      <section className="card-pop mt-6 bg-card p-6">
        {step === 0 && (
          <div className="grid gap-4">
            <Field label="Event name">
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lagos Tech Fest 2026" autoFocus />
            </Field>
            <Field label="Event code" hint="Staff type this to sign in. Leave blank to make one from the name.">
              <input
                className="field font-mono uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
                maxLength={24}
                placeholder="LAGOS-TECH-FEST"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts">
                <input className="field" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </Field>
              <Field label="Ends">
                <input className="field" type="datetime-local" value={endsAt} min={startsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-3">
            <h2 className="text-xl font-extrabold">Where is it?</h2>
            <p className="text-sm">This puts your venue on the map so buyers can use "Use my location" and you can see runners. You can skip it and add it later.</p>
            <PlaceSearch value={place} onChange={setPlace} />
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <h2 className="text-xl font-extrabold">Start your venue plan</h2>
            <p className="text-sm">Pick your venue if it's in our library, a generic layout, or upload a plan file. You'll edit it in the next screen.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {sorted.map((t) => (
                <button
                  key={t.code}
                  type="button"
                  onClick={() => setStart({ kind: "template", code: t.code })}
                  className={cn(
                    "rounded-2xl border-2 border-ink p-3 text-left transition hover:-translate-y-0.5",
                    start.kind === "template" && start.code === t.code ? "bg-sun shadow-pop" : "bg-card",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold leading-tight">{t.name}</span>
                    {place && t.lat !== undefined && t.lng !== undefined && distanceM(place.lat, place.lng, t.lat, t.lng) < 1500 && (
                      <span className="chip shrink-0 bg-mint text-[10px]">Near your location</span>
                    )}
                  </div>
                  <span className="mt-1 block text-xs">{t.summary}</span>
                  <span className="mt-1 block text-[11px] font-semibold text-muted-foreground">
                    {t.kind === "generic" ? "Generic layout" : QUALITY[t.dataQuality]}
                    {t.capacity ? ` · ${t.capacity}` : ""}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={cn("btn btn-sm", start.kind === "blank" ? "bg-sun" : "bg-card")}
                onClick={() => setStart({ kind: "blank" })}
              >
                Start blank (draw over a tracing image)
              </button>
              <label className={cn("btn btn-sm cursor-pointer", start.kind === "upload" ? "bg-sun" : "bg-card")}>
                Upload a plan file (.json)
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setStart({ kind: "upload", name: file.name, plan: JSON.parse(await file.text()) });
                    } catch {
                      toast.error(`${file.name} isn't valid JSON`);
                    }
                  }}
                />
              </label>
              <a className="btn btn-sm bg-card" href="/api/venue-templates/GENERIC-BALLROOM" target="_blank" rel="noreferrer">
                See the file format
              </a>
            </div>
            {start.kind === "upload" && <p className="text-sm font-bold">📄 {start.name} will be checked when you create the event.</p>}
            {preview.data && start.kind === "template" && (
              <figure className="rounded-2xl border-2 border-ink bg-card p-3">
                <PlanPreview plan={preview.data.plan} className="mx-auto max-h-72 w-full" />
                <figcaption className="mt-2 text-xs">
                  {preview.data.plan.canvas.notes}
                  {preview.data.sources.length > 0 && (
                    <>
                      {" "}Sources:{" "}
                      {preview.data.sources.map((s, i) => (
                        <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="underline">
                          {s.label}
                          {i < preview.data!.sources.length - 1 ? ", " : ""}
                        </a>
                      ))}
                    </>
                  )}
                </figcaption>
              </figure>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4">
            <h2 className="text-xl font-extrabold">Who delivers the orders?</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  ["own_runners", "🙋 We'll bring our own runners", "Add your runners in the Staff tab. They sign in on their phones with the event code and a PIN."],
                  ["layovr_runners", "🛵 Layovr handles deliveries", "We supply trained runners. Your request goes to the Layovr team, who confirm and assign runners."],
                ] as const
              ).map(([value, title, text]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={cn("rounded-2xl border-2 border-ink p-4 text-left", mode === value ? "bg-sun shadow-pop" : "bg-card")}
                >
                  <span className="block font-bold">{title}</span>
                  <span className="mt-1 block text-sm">{text}</span>
                </button>
              ))}
            </div>
            {mode === "layovr_runners" && (
              <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                <Field label="Runners needed" hint="About 1 per 500 guests">
                  <input className="field" type="number" min={1} max={500} value={runnersNeeded} onChange={(e) => setRunnersNeeded(Number(e.target.value))} />
                </Field>
                <Field label="Anything we should know?" hint="Optional: hours, restricted areas, dress code">
                  <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                </Field>
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="grid gap-2">
            <h2 className="text-xl font-extrabold">Ready to create</h2>
            <dl className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="font-bold">Event</dt>
              <dd>
                {name} {code && <span className="font-mono">({code})</span>}
              </dd>
              <dt className="font-bold">Dates</dt>
              <dd>{startsAt ? `${new Date(startsAt).toLocaleString("en-NG")}${endsAt ? ` → ${new Date(endsAt).toLocaleString("en-NG")}` : ""}` : "Not set"}</dd>
              <dt className="font-bold">Location</dt>
              <dd>{place?.address ?? "Not set"}</dd>
              <dt className="font-bold">Venue plan</dt>
              <dd>{start.kind === "template" ? chosenTemplate?.name : start.kind === "upload" ? start.name : "Blank"}</dd>
              <dt className="font-bold">Deliveries</dt>
              <dd>{mode === "own_runners" ? "Our own runners" : `Layovr runners (${runnersNeeded} requested)`}</dd>
            </dl>
            <p className="mt-2 text-sm text-muted-foreground">The event starts as a draft. Buyers only see it after you publish.</p>
          </div>
        )}
      </section>

      <div className="mt-6 flex justify-between gap-3">
        <button type="button" className="btn bg-card" disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn bg-coral" disabled={!canNext} onClick={() => setStep(step + 1)}>
            {step === 1 && !place ? "Skip for now" : "Next"}
          </button>
        ) : (
          <button type="button" className="btn bg-coral" disabled={busy} onClick={() => void create()}>
            {busy ? "Creating…" : "Create event"}
          </button>
        )}
      </div>
    </div>
  );
}
