import type { VenuePlan } from "@layovr/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { FloorPlan } from "@/components/FloorPlan";
import { useGpsCalibration } from "@/components/GpsCalibration";
import { PlaceSearch, type PickedPlace } from "@/components/PlaceSearch";
import { PlanEditor } from "@/components/PlanEditor";
import { QrImage } from "@/components/QrImage";
import { Field, Money } from "@/components/ui-bits";
import {
  papi,
  refresh,
  usePlan,
  useStaff,
  useVendors,
  type EventDetail,
  type PlanSaveResult,
  type TeamMember,
  type TeamVendor,
} from "@/lib/partnerApi";
import { formatNaira } from "@/lib/store";
import type { Spot, StaffRole, Venue, Zone } from "@/lib/types";
import { cn, compressImage } from "@/lib/utils";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/** A plan file shaped for FloorPlan (which draws venues/zones/spots from the snapshot). */
export function planAsFloor(event: EventDetail, plan: VenuePlan): { venue: Venue; zones: Zone[]; spots: Spot[] } {
  const { areas, spots, venue: _v, ...meta } = plan;
  return {
    venue: {
      id: event.id,
      code: event.code,
      name: event.name,
      city: event.city,
      type: "Event",
      fill: "sun",
      isLive: true,
      feePct: event.feePct,
      feeFlatKobo: event.feeFlatKobo,
      absorbLimitKobo: event.absorbLimitKobo,
      isSample: false,
      plan: meta,
      ...(event.floorPlanUrl ? { floorPlanUrl: event.floorPlanUrl } : {}),
    },
    zones: areas.map((a) => ({
      id: a.code,
      venueId: event.id,
      code: a.code,
      name: a.name,
      restricted: a.access === "restricted",
      shape: a.shape,
      kind: a.kind,
      ...(a.section ? { section: a.section } : {}),
      ...(a.level === undefined ? {} : { level: a.level }),
    })),
    spots: spots.map((s) => ({ id: s.code, venueId: event.id, zoneId: s.area, code: s.code, label: s.label, x: s.x, y: s.y, active: s.active })),
  };
}

/* ------------------------------------------------------------------ overview */

export function OverviewTab({ event }: { event: EventDetail }) {
  const [busy, setBusy] = useState(false);
  const setStatus = async (status: "live" | "draft" | "ended") => {
    setBusy(true);
    try {
      await papi(`/partner/events/${event.id}`, { method: "PATCH", body: { status } });
      await refresh(["events"]);
      toast.success(status === "live" ? "Published: buyers can order now" : status === "draft" ? "Back to draft" : "Event ended");
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  const ready = event.checklist.filter((c) => ["plan", "vendors"].includes(c.key)).every((c) => c.done);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <section className="card-pop bg-card p-6">
        <h2 className="text-xl font-extrabold">Before you publish</h2>
        <ul className="mt-3 grid gap-2">
          {event.checklist.map((c) => (
            <li key={c.key} className="flex items-center gap-2">
              <span className={cn("grid h-6 w-6 place-items-center rounded-full border-2 border-ink text-xs", c.done ? "bg-mint" : "bg-card")}>
                {c.done ? "✓" : ""}
              </span>
              <span className={cn(!c.done && "font-semibold")}>{c.label}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-3">
          {event.status !== "live" ? (
            <button type="button" className="btn bg-coral" disabled={busy || !ready} onClick={() => void setStatus("live")}>
              🚀 Publish to buyers
            </button>
          ) : (
            <>
              <button type="button" className="btn bg-card" disabled={busy} onClick={() => void setStatus("draft")}>
                Unpublish
              </button>
              <button
                type="button"
                className="btn bg-blush"
                disabled={busy}
                onClick={() => window.confirm("End the event? Buyers can no longer order.") && void setStatus("ended")}
              >
                End event
              </button>
            </>
          )}
        </div>
        {!ready && <p className="mt-2 text-sm text-muted-foreground">Publishing needs a plan with spots and at least one vendor with an item.</p>}
      </section>

      <section className="card-pop grid gap-3 bg-sun p-6">
        <h2 className="text-xl font-extrabold">Links</h2>
        <div className="flex items-center gap-3">
          <QrImage value={event.buyerUrl} size={96} className="rounded-lg border-2 border-ink" />
          <div className="min-w-0 text-sm">
            <div className="font-bold">Buyer page</div>
            <a className="break-all underline" href={event.buyerUrl} target="_blank" rel="noreferrer">
              {event.buyerUrl}
            </a>
            <p className="text-xs">For posters and the event app. Seat cards point at exact spots.</p>
          </div>
        </div>
        <div className="text-sm">
          <div className="font-bold">Team sign-in</div>
          <p>
            Staff open <b>/staff</b> on their phone and enter event code <span className="font-mono font-bold">{event.code}</span> and their PIN.
          </p>
        </div>
        <Link to="/dashboard/events/$eventId/print" params={{ eventId: event.id }} className="btn btn-sm w-fit bg-card">
          🖨️ Print QR cards
        </Link>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ plan */

export function PlanTab({ event }: { event: EventDetail }) {
  const plan = usePlan(event.id);
  if (!plan.data) return <p>Loading the plan…</p>;
  return <PlanTabLoaded event={event} plan={plan.data} />;
}

function PlanTabLoaded({ event, plan }: { event: EventDetail; plan: VenuePlan }) {
  const floor = planAsFloor(event, plan);
  const cal = useGpsCalibration(floor.venue, async (points) => {
    const r = await papi<{ residualM: number[] }>(`/partner/events/${event.id}/plan/geo`, { method: "PATCH", body: { points } });
    await refresh(["events", event.id]);
    return r;
  });
  const save = async (next: VenuePlan): Promise<PlanSaveResult> => {
    const r = await papi<PlanSaveResult>(`/partner/events/${event.id}/plan?prune=1`, { method: "PUT", body: next });
    await refresh(["events"]);
    return r;
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.code.toLowerCase()}.plan.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-6">
      <PlanEditor key={JSON.stringify(plan).length} initial={plan} tracingUrl={event.floorPlanUrl} onSave={save} />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card-pop grid h-fit gap-2 bg-card p-5">
          <h3 className="font-display text-lg font-bold">Tracing image</h3>
          <p className="text-sm">Upload the venue's floor plan or a photo of its map. It shows faintly under your shapes so you can trace it.</p>
          <input
            type="file"
            accept="image/*"
            className="text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                await papi(`/partner/events/${event.id}`, { method: "PATCH", body: { floorPlanUrl: await compressImage(file, 1600, 0.8) } });
                await refresh(["events", event.id]);
                toast.success("Tracing image added");
              } catch (x) {
                err(x);
              }
            }}
          />
          {event.floorPlanUrl && (
            <button
              type="button"
              className="btn btn-sm w-fit bg-card"
              onClick={async () => {
                await papi(`/partner/events/${event.id}`, { method: "PATCH", body: { floorPlanUrl: "" } }).catch(err);
                await refresh(["events", event.id]);
              }}
            >
              Remove image
            </button>
          )}
        </section>

        <section className="card-pop grid h-fit gap-2 bg-card p-5">
          <h3 className="font-display text-lg font-bold">Plan file</h3>
          <p className="text-sm">
            The whole map as one <b>layovr-plan/1</b> file: share it with your team, edit it in a spreadsheet tool, or give it to your venue.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm bg-card" onClick={download}>
              ⬇ Download
            </button>
            <label className="btn btn-sm cursor-pointer bg-card">
              ⬆ Replace from file
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const next = JSON.parse(await file.text()) as VenuePlan;
                    const dry = await papi<PlanSaveResult>(`/partner/events/${event.id}/plan?dryRun=1`, { method: "PUT", body: { ...next, venue: { ...next.venue, code: event.code } } });
                    if (!dry.ok) {
                      toast.error(dry.errors[0] ?? "That file has problems");
                      return;
                    }
                    if (!window.confirm(`Replace the plan with ${file.name}? Areas and spots not in the file are removed.`)) return;
                    await save({ ...next, venue: { ...next.venue, code: event.code } });
                    await refresh(["events", event.id, "plan"]);
                    toast.success("Plan replaced");
                  } catch (x) {
                    err(x);
                  }
                }}
              />
            </label>
          </div>
        </section>

        <section className="card-pop grid h-fit gap-3 bg-card p-5">
          <FloorPlan
            venue={floor.venue}
            zones={floor.zones}
            spots={floor.spots}
            {...(cal.awaitingClick ? { onPlace: cal.place } : {})}
            caption={cal.awaitingClick ? "Now click where you're standing." : "Used for GPS calibration."}
          />
          {cal.panel}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ vendors */

const blankItem = { name: "", price: "", category: "Menu", service: false };

export function VendorsTab({ event, plan }: { event: EventDetail; plan: VenuePlan | undefined }) {
  const vendors = useVendors(event.id);
  const [form, setForm] = useState({ name: "", category: "Food & drink", emoji: "🍽️", zoneCode: "", stallLabel: "", contactName: "", contactPhone: "" });
  const [open, setOpen] = useState<string | null>(null);
  const areas = plan?.areas ?? [];
  const zoneIdFor = (code: string) => `z_${event.id.replace(/^v_/, "")}_${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

  const add = async () => {
    try {
      const v = await papi<TeamVendor>(`/partner/events/${event.id}/vendors`, {
        body: {
          name: form.name.trim(),
          category: form.category,
          emoji: form.emoji || "🍽️",
          stallLabel: form.stallLabel.trim(),
          ...(form.zoneCode ? { zoneId: zoneIdFor(form.zoneCode) } : {}),
          ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
          ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
        },
      });
      setForm({ ...form, name: "", stallLabel: "", contactName: "", contactPhone: "" });
      setOpen(v.id);
      await refresh(["events", event.id]);
      toast.success(`${v.name} added`);
    } catch (e) {
      err(e);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="grid h-fit gap-3">
        {vendors.data?.length === 0 && <p className="card-pop bg-card p-6">No vendors yet. Add one, or add them as placeholders and send each an invite link to fill in their own menu.</p>}
        {vendors.data?.map((v) => (
          <VendorCard key={v.id} event={event} vendor={v} areas={areas} zoneIdFor={zoneIdFor} open={open === v.id} onToggle={() => setOpen(open === v.id ? null : v.id)} />
        ))}
      </section>
      <form
        className="card-pop grid h-fit gap-3 bg-sun p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <h3 className="font-display text-lg font-bold">Add a vendor</h3>
        <div className="grid grid-cols-[4rem_1fr] gap-2">
          <Field label="Icon">
            <input className="field py-1.5 text-center" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={4} />
          </Field>
          <Field label="Name">
            <input className="field py-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
        </div>
        <Field label="What they sell">
          <input className="field py-1.5" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </Field>
        <Field label="Area">
          <select className="field py-1.5" value={form.zoneCode} onChange={(e) => setForm({ ...form, zoneCode: e.target.value })}>
            <option value="">Not set yet</option>
            {areas.map((a) => (
              <option key={a.code} value={a.code}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Where exactly" hint="e.g. Hall 2, left of the stage">
          <input className="field py-1.5" value={form.stallLabel} onChange={(e) => setForm({ ...form, stallLabel: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Contact name">
            <input className="field py-1.5" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </Field>
          <Field label="Contact phone" hint="Not shown to buyers">
            <input className="field py-1.5" type="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
          </Field>
        </div>
        <button type="submit" className="btn bg-coral" disabled={!form.name.trim()}>
          Add vendor
        </button>
      </form>
    </div>
  );
}

function VendorCard({
  event,
  vendor: v,
  areas,
  zoneIdFor,
  open,
  onToggle,
}: {
  event: EventDetail;
  vendor: TeamVendor;
  areas: VenuePlan["areas"];
  zoneIdFor: (code: string) => string;
  open: boolean;
  onToggle: () => void;
}) {
  const [row, setRow] = useState(blankItem);
  const [invite, setInvite] = useState<string | null>(null);
  const area = areas.find((a) => zoneIdFor(a.code) === v.zoneId);
  const base = `/partner/events/${event.id}/vendors/${v.id}`;
  const after = () => refresh(["events", event.id]);

  return (
    <article className="card-pop bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 p-4">
        <button type="button" className="text-left" onClick={onToggle} aria-expanded={open}>
          <span className="font-display text-lg font-bold">
            {v.emoji} {v.name}
          </span>
          <span className="block text-sm text-muted-foreground">
            {v.products.length} item{v.products.length === 1 ? "" : "s"} · {area?.name ?? "area not set"}
            {v.stallLabel ? ` · ${v.stallLabel}` : ""}
            {v.contactPhone ? ` · ${v.contactPhone}` : ""}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-sm font-bold">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={v.isOpen}
              onChange={async (e) => {
                await papi(base, { method: "PATCH", body: { isOpen: e.target.checked } }).catch(err);
                await after();
              }}
            />
            Open
          </label>
          <button
            type="button"
            className="btn btn-sm bg-sun"
            onClick={async () => {
              try {
                const r = await papi<{ url: string }>(`${base}/invite`, { body: {} });
                setInvite(r.url);
                await navigator.clipboard?.writeText(r.url).catch(() => undefined);
                toast.success("Invite link copied");
              } catch (e) {
                err(e);
              }
            }}
          >
            ✉️ Invite link
          </button>
        </div>
      </header>
      {invite && (
        <div className="mx-4 mb-3 rounded-xl border-2 border-ink bg-mint/50 p-3 text-sm">
          <p className="break-all font-mono text-xs">{invite}</p>
          <p className="mt-1">Single use, valid 7 days. The vendor adds their own stall details and menu.</p>
          <a
            className="btn btn-sm mt-2 bg-card"
            target="_blank"
            rel="noreferrer"
            href={`https://wa.me/${(v.contactPhone ?? "").replace(/\D/g, "").replace(/^0/, "234")}?text=${encodeURIComponent(`Hi${v.contactName ? ` ${v.contactName}` : ""}, please add your menu for ${event.name} on Layovr: ${invite}`)}`}
          >
            Share on WhatsApp
          </a>
        </div>
      )}
      {open && (
        <div className="border-t-2 border-ink/10 p-4">
          <ul className="divide-y-2 divide-ink/10">
            {v.products.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <b>{p.name}</b> · {p.category}
                  {p.kind === "service" ? " · service" : ""}
                </span>
                <span className="flex items-center gap-3">
                  <Money kobo={p.priceKobo} />
                  <label className="flex items-center gap-1 text-xs font-bold">
                    <input
                      type="checkbox"
                      checked={p.inStock}
                      onChange={async (e) => {
                        const { id: _id, vendorId: _v, ...rest } = p;
                        await papi(`${base}/items/${p.id}`, { method: "PUT", body: { ...rest, inStock: e.target.checked } }).catch(err);
                        await after();
                      }}
                    />
                    In stock
                  </label>
                  <button
                    type="button"
                    className="text-xs font-bold underline"
                    onClick={async () => {
                      await papi(`${base}/items/${p.id}`, { method: "DELETE" }).catch(err);
                      await after();
                    }}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 grid grid-cols-[1fr_6rem] gap-2 sm:grid-cols-[1fr_7rem_8rem_auto]"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await papi(`${base}/items`, {
                  body: {
                    name: row.name.trim(),
                    priceKobo: Math.round(Number(row.price) * 100),
                    category: row.category.trim() || "Menu",
                    kind: row.service ? "service" : "goods",
                    inStock: true,
                    fulfilment: row.service ? "collect_and_return" : "deliver",
                  },
                });
                setRow({ ...blankItem, category: row.category });
                await after();
              } catch (x) {
                err(x);
              }
            }}
          >
            <input className="field py-1.5" placeholder="Item name" value={row.name} onChange={(e) => setRow({ ...row, name: e.target.value })} aria-label="Item name" />
            <input className="field py-1.5" placeholder="₦ price" inputMode="numeric" value={row.price} onChange={(e) => setRow({ ...row, price: e.target.value.replace(/[^\d]/g, "") })} aria-label="Price in naira" />
            <input className="field py-1.5" placeholder="Section" value={row.category} onChange={(e) => setRow({ ...row, category: e.target.value })} aria-label="Menu section" />
            <button type="submit" className="btn btn-sm bg-coral" disabled={!row.name.trim() || !(Number(row.price) > 0)}>
              Add item
            </button>
          </form>
          <button
            type="button"
            className="mt-3 text-xs font-bold text-destructive underline"
            onClick={async () => {
              if (!window.confirm(`Remove ${v.name}? Vendors with orders are closed instead.`)) return;
              const r = await papi<{ removed: boolean }>(base, { method: "DELETE" }).catch((e) => (err(e), null));
              if (r) toast(r.removed ? `${v.name} removed` : `${v.name} has orders, so it's closed instead`);
              await after();
            }}
          >
            Remove vendor
          </button>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ staff */

const ROLES: { role: StaffRole; label: string; help: string }[] = [
  { role: "runner", label: "Runner", help: "Buys at stalls and delivers" },
  { role: "dispatch", label: "Dispatch", help: "Runs the ops board" },
  { role: "admin", label: "On-site admin", help: "Spots, menus, fees" },
  { role: "capture", label: "Menu capture", help: "Records stalls on a phone" },
];

export function StaffTab({ event }: { event: EventDetail }) {
  const staff = useStaff(event.id);
  const [form, setForm] = useState({ name: "", role: "runner" as StaffRole, phone: "", restricted: false, float: "" });
  const [issued, setIssued] = useState<{ member: TeamMember; pin: string } | null>(null);
  const shareText = (m: TeamMember, pin: string) =>
    `Hi ${m.name}, you're ${m.role === "runner" ? "a runner" : `on ${m.role}`} for ${event.name} on Layovr. Open ${window.location.origin}/staff and sign in with event code ${event.code} and PIN ${pin}. Keep the PIN private.`;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="card-pop h-fit overflow-x-auto bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Role</th>
              <th className="p-3">Float</th>
              <th className="p-3">On shift</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-ink/10">
            {staff.data?.map((m) => (
              <tr key={m.id}>
                <td className="p-3">
                  <b>{m.name}</b>
                  {m.canEnterRestricted && " 🔑"}
                  {m.providedBy === "layovr" && <span className="chip ml-1 bg-lilac px-1.5 py-0 text-[10px]">Layovr</span>}
                  <span className="block text-xs text-muted-foreground">{m.phone}</span>
                </td>
                <td className="p-3">{ROLES.find((r) => r.role === m.role)?.label}</td>
                <td className="p-3">{m.role === "runner" ? formatNaira(m.floatKobo) : "—"}</td>
                <td className="p-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={m.onShift}
                    aria-label={`${m.name} on shift`}
                    onChange={async (e) => {
                      await papi(`/partner/events/${event.id}/staff/${m.id}`, { method: "PATCH", body: { onShift: e.target.checked } }).catch(err);
                      await refresh(["events", event.id, "staff"]);
                    }}
                  />
                </td>
                <td className="whitespace-nowrap p-3 text-right">
                  <button
                    type="button"
                    className="text-xs font-bold underline"
                    onClick={async () => {
                      const r = await papi<{ pin: string }>(`/partner/events/${event.id}/staff/${m.id}/reset-pin`, { body: {} }).catch((e) => (err(e), null));
                      if (r) setIssued({ member: m, pin: r.pin });
                    }}
                  >
                    New PIN
                  </button>{" "}
                  <button
                    type="button"
                    className="text-xs font-bold text-destructive underline"
                    onClick={async () => {
                      if (!window.confirm(`Remove ${m.name}?`)) return;
                      const r = await papi<{ removed: boolean }>(`/partner/events/${event.id}/staff/${m.id}`, { method: "DELETE" }).catch((e) => (err(e), null));
                      if (r && !r.removed) toast(`${m.name} has order history, so they're off shift instead`);
                      await refresh(["events", event.id]);
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {staff.data?.length === 0 && <p className="p-4">No one yet. Add your dispatcher and runners.</p>}
      </section>

      <div className="grid h-fit gap-4">
        {issued && (
          <section className="card-pop grid gap-2 bg-mint p-5" role="status">
            <h3 className="font-display text-lg font-bold">PIN for {issued.member.name}</h3>
            <p className="font-mono text-3xl font-extrabold tracking-[0.3em]">{issued.pin}</p>
            <p className="text-sm">
              Event code <b className="font-mono">{event.code}</b>. This PIN won't be shown again.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                className="btn btn-sm bg-card"
                target="_blank"
                rel="noreferrer"
                href={`https://wa.me/${issued.member.phone.replace(/\D/g, "").replace(/^0/, "234")}?text=${encodeURIComponent(shareText(issued.member, issued.pin))}`}
              >
                Share on WhatsApp
              </a>
              <button type="button" className="btn btn-sm bg-card" onClick={() => void navigator.clipboard?.writeText(shareText(issued.member, issued.pin))}>
                Copy message
              </button>
              <button type="button" className="btn btn-sm bg-card" onClick={() => setIssued(null)}>
                Done
              </button>
            </div>
          </section>
        )}
        <form
          className="card-pop grid gap-3 bg-sun p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await papi<{ member: TeamMember; pin: string }>(`/partner/events/${event.id}/staff`, {
                body: {
                  name: form.name.trim(),
                  role: form.role,
                  phone: form.phone.trim(),
                  canEnterRestricted: form.restricted,
                  floatKobo: Math.round(Number(form.float || 0) * 100),
                },
              });
              setIssued(r);
              setForm({ ...form, name: "", phone: "", float: "" });
              await refresh(["events", event.id]);
            } catch (x) {
              err(x);
            }
          }}
        >
          <h3 className="font-display text-lg font-bold">Add someone</h3>
          <Field label="Name">
            <input className="field py-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map((r) => (
              <button
                key={r.role}
                type="button"
                onClick={() => setForm({ ...form, role: r.role })}
                className={cn("rounded-xl border-2 border-ink p-2 text-left text-sm", form.role === r.role ? "bg-card shadow-pop" : "bg-sun")}
              >
                <b>{r.label}</b>
                <span className="block text-xs">{r.help}</span>
              </button>
            ))}
          </div>
          <Field label="Phone" hint="For WhatsApp sign-in details and buyer calls">
            <input className="field py-1.5" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          {form.role === "runner" && (
            <>
              <Field label="Float (₦)" hint="Cash or transfer budget for buying at stalls">
                <input className="field py-1.5" inputMode="numeric" value={form.float} onChange={(e) => setForm({ ...form, float: e.target.value.replace(/[^\d]/g, "") })} />
              </Field>
              <label className="flex items-center gap-2 text-sm font-bold">
                <input type="checkbox" className="h-5 w-5" checked={form.restricted} onChange={(e) => setForm({ ...form, restricted: e.target.checked })} />
                🔑 Can enter restricted areas (VIP, backstage)
              </label>
            </>
          )}
          <button type="submit" className="btn bg-coral" disabled={!form.name.trim()}>
            Add and get PIN
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ deliveries */

export function DeliveriesTab({ event }: { event: EventDetail }) {
  const [runners, setRunners] = useState(event.runnerRequest.runnersNeeded ?? 4);
  const [note, setNote] = useState(event.runnerRequest.note ?? "");
  const r = event.runnerRequest;
  const statusText = {
    none: "Not requested",
    requested: "Requested: the Layovr team will confirm",
    approved: "Approved: Layovr runners are assigned",
    declined: "Declined",
  }[r.status];

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="card-pop grid h-fit gap-3 bg-card p-6">
        <h2 className="text-xl font-extrabold">Who delivers</h2>
        {(["own_runners", "layovr_runners"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={cn("rounded-2xl border-2 border-ink p-4 text-left", event.deliveryMode === mode ? "bg-sun shadow-pop" : "bg-card")}
            onClick={async () => {
              if (mode === event.deliveryMode) return;
              await papi(`/partner/events/${event.id}`, { method: "PATCH", body: { deliveryMode: mode } }).catch(err);
              await refresh(["events"]);
            }}
          >
            <b>{mode === "own_runners" ? "🙋 Our own runners" : "🛵 Layovr handles deliveries"}</b>
            <span className="block text-sm">
              {mode === "own_runners" ? "Add runners in the Staff tab." : "We supply runners after the Layovr team approves your request."}
            </span>
          </button>
        ))}
      </section>
      {event.deliveryMode === "layovr_runners" && (
        <form
          className="card-pop grid h-fit gap-3 bg-sun p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            await papi(`/partner/events/${event.id}/runner-request`, { body: { runnersNeeded: runners, ...(note.trim() ? { note: note.trim() } : {}) } }).catch(err);
            await refresh(["events"]);
            toast.success("Request sent to the Layovr team");
          }}
        >
          <h2 className="text-xl font-extrabold">Layovr runners</h2>
          <p className="font-bold">{statusText}</p>
          {r.reply && <p className="rounded-xl border-2 border-ink bg-card p-3 text-sm">Layovr: “{r.reply}”</p>}
          <Field label="Runners needed">
            <input className="field" type="number" min={1} max={500} value={runners} onChange={(e) => setRunners(Number(e.target.value))} />
          </Field>
          <Field label="Notes for the Layovr team" hint="Hours, restricted areas, dress code">
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
          <button type="submit" className="btn bg-coral">
            {r.status === "none" || r.status === "declined" ? "Send request" : "Update request"}
          </button>
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ settings */

export function SettingsTab({ event }: { event: EventDetail }) {
  const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
  const [name, setName] = useState(event.name);
  const [startsAt, setStartsAt] = useState(toLocal(event.startsAt));
  const [endsAt, setEndsAt] = useState(toLocal(event.endsAt));
  const [place, setPlace] = useState<PickedPlace | null>(
    event.lat !== null && event.lng !== null ? { address: event.address ?? "", lat: event.lat, lng: event.lng } : null,
  );
  const [pct, setPct] = useState(String(Math.round(event.feePct * 1000) / 10));
  const [flat, setFlat] = useState(String(event.feeFlatKobo / 100));
  const [absorb, setAbsorb] = useState(String(event.absorbLimitKobo / 100));
  const placeChanged = place && (place.lat !== event.lat || place.lng !== event.lng);

  return (
    <form
      className="card-pop grid max-w-3xl gap-4 bg-card p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await papi(`/partner/events/${event.id}`, {
            method: "PATCH",
            body: {
              name: name.trim(),
              startsAt: startsAt ? new Date(startsAt).toISOString() : null,
              endsAt: endsAt ? new Date(endsAt).toISOString() : null,
              feePct: Number(pct) / 100,
              feeFlatKobo: Math.round(Number(flat) * 100),
              absorbLimitKobo: Math.round(Number(absorb) * 100),
              ...(placeChanged ? { location: place } : {}),
            },
          });
          await refresh(["events"]);
          toast.success("Saved");
        } catch (x) {
          err(x);
        }
      }}
    >
      <Field label="Event name">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts">
          <input className="field" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label="Ends">
          <input className="field" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
      </div>
      <div>
        <span className="mb-1.5 block text-sm font-bold">Location</span>
        <PlaceSearch value={place} onChange={setPlace} />
      </div>
      <h3 className="font-display text-lg font-bold">Service fee buyers pay</h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="% of items">
          <input className="field" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
        </Field>
        <Field label="Flat (₦)">
          <input className="field" inputMode="numeric" value={flat} onChange={(e) => setFlat(e.target.value)} />
        </Field>
        <Field label="Price changes we absorb (₦)">
          <input className="field" inputMode="numeric" value={absorb} onChange={(e) => setAbsorb(e.target.value)} />
        </Field>
      </div>
      <p className="text-sm text-muted-foreground">
        On a ₦3,000 order the fee would be <b>{formatNaira(Math.ceil((300000 * (Number(pct) / 100)) / 100) * 100 + Math.round(Number(flat) * 100))}</b>.
      </p>
      <button type="submit" className="btn w-fit bg-coral">
        Save settings
      </button>
    </form>
  );
}
