import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PLAN_TEMPLATE, areaAt } from "@layovr/shared";
import { FloorPlan } from "@/components/FloorPlan";
import { useGpsCalibration } from "@/components/GpsCalibration";
import { QrImage, downloadQr, spotUrl } from "@/components/QrImage";
import { RequireStaff } from "@/components/RequireStaff";
import { Field, Money } from "@/components/ui-bits";
import {
  deleteProduct,
  deleteSpot,
  exportPlan,
  feeFor,
  importPlan,
  type PlanImportResult,
  formatNaira,
  resetDemo,
  saveGeo,
  uid,
  updateVenue,
  updateZone,
  upsertProduct,
  upsertSpot,
  upsertVendor,
  useDB,
} from "@/lib/store";
import type { DB, Spot, Staff, Venue } from "@/lib/types";
import { cn, compressImage } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin · Layovr" }] }),
  component: () => (
    <RequireStaff roles={["admin"]}>{(me) => <Admin me={me} />}</RequireStaff>
  ),
});

const TABS = ["Spots & QR", "Menus", "Floor plan", "Settings"] as const;
type Tab = (typeof TABS)[number];

function Admin({ me }: { me: Staff }) {
  const d = useDB();
  const [tab, setTab] = useState<Tab>("Spots & QR");
  const venue = d.venues.find((v) => v.id === me.venueId);
  if (!venue) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-3xl font-extrabold">Admin</h1>
      <p className="text-muted-foreground">{venue.name}</p>
      <div className="mt-5 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full border-2 border-ink px-4 py-2 text-sm font-bold",
              tab === t ? "bg-sun shadow-pop" : "bg-card",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "Spots & QR" && <SpotsTab d={d} venue={venue} />}
        {tab === "Menus" && <MenusTab d={d} venue={venue} />}
        {tab === "Floor plan" && <PlanTab d={d} venue={venue} />}
        {tab === "Settings" && <SettingsTab venue={venue} allowReset={d.config.allowReset} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- spots */

const blankSpot = (venue: Venue, zoneId: string, x = 50, y = 50): Spot => ({
  id: uid("s"),
  venueId: venue.id,
  zoneId,
  code: "",
  label: "",
  x,
  y,
  active: true,
});

function SpotsTab({ d, venue }: { d: DB; venue: Venue }) {
  const zones = d.zones.filter((z) => z.venueId === venue.id);
  const spots = d.spots.filter((s) => s.venueId === venue.id);
  const [edit, setEdit] = useState<Spot | null>(null);

  const zoneAt = (x: number, y: number, level: number) =>
    areaAt(zones, x, y, level)?.id ?? zones[0]?.id ?? "";

  /** Next free code in the standard format: section + level, area, number (B0-EXH1-3). */
  const suggestCode = (zoneId: string) => {
    const z = zones.find((x) => x.id === zoneId);
    if (!z) return "";
    const prefix = `${z.section ?? ""}${z.level ?? ""}`;
    const stem = `${prefix ? `${prefix}-` : ""}${z.code}-`;
    let n = 1;
    while (d.spots.some((s) => s.code === `${stem}${n}`)) n++;
    return `${stem}${n}`;
  };
  const newSpot = (zoneId: string, x?: number, y?: number) => ({
    ...blankSpot(venue, zoneId, x, y),
    code: suggestCode(zoneId),
  });

  const save = () => {
    if (!edit) return;
    const code = edit.code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
    if (!code || !edit.label.trim()) {
      toast.error("A spot needs a code and a label.");
      return;
    }
    if (d.spots.some((s) => s.code === code && s.id !== edit.id)) {
      toast.error(`Code ${code} is already used.`);
      return;
    }
    upsertSpot({ ...edit, code, label: edit.label.trim() });
    toast.success(`Saved ${code}`);
    setEdit(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <FloorPlan
          venue={venue}
          zones={zones}
          spots={spots.filter((s) => s.active)}
          {...(edit ? { highlightSpotId: edit.id } : {})}
          onPlace={(x, y, level) =>
            setEdit(
              edit
                ? { ...edit, x, y, zoneId: zoneAt(x, y, level) }
                : newSpot(zoneAt(x, y, level), x, y),
            )
          }
          onSpotClick={(s) => setEdit(s)}
          caption="Click empty space to add a spot, or click a pin to edit it. While editing, clicking moves the pin."
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/admin/print" className="btn bg-coral">
            🖨️ Print all QR cards
          </Link>
          <button
            type="button"
            className="btn bg-card"
            onClick={() => setEdit(newSpot(zones[0]?.id ?? ""))}
          >
            + New spot
          </button>
        </div>
      </div>

      <div className="grid h-fit gap-4">
        {edit && (
          <form
            className="card-pop grid gap-3 bg-sun p-5"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <h2 className="text-xl font-extrabold">
              {spots.some((s) => s.id === edit.id)
                ? `Edit ${edit.code}`
                : "New spot"}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code" hint="Printed under the QR">
                <input
                  className="field font-mono uppercase"
                  value={edit.code}
                  onChange={(e) => setEdit({ ...edit, code: e.target.value })}
                  placeholder="B0-EXH1-3"
                />
              </Field>
              <Field label="Zone">
                <select
                  className="field"
                  value={edit.zoneId}
                  onChange={(e) => setEdit({ ...edit, zoneId: e.target.value })}
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                      {z.section || z.level !== undefined
                        ? ` (${z.section ?? ""}${z.level ?? "all floors"})`
                        : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Label buyers and runners see">
              <input
                className="field"
                value={edit.label}
                onChange={(e) => setEdit({ ...edit, label: e.target.value })}
                placeholder="Main Bowl, centre block, row F aisle"
              />
            </Field>
            <Field label="Landmark" hint="Optional">
              <input
                className="field"
                value={edit.landmark ?? ""}
                onChange={(e) => setEdit({ ...edit, landmark: e.target.value })}
              />
            </Field>
            <Field label="Runner directions from the ops desk">
              <textarea
                className="field min-h-20"
                value={edit.directions ?? ""}
                onChange={(e) =>
                  setEdit({ ...edit, directions: e.target.value })
                }
                placeholder="Through door B, up the left stairs, third aisle on the right"
              />
            </Field>
            <p className="text-xs">
              Position: {edit.x}% across, {edit.y}% down
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-sm bg-coral">
                Save spot
              </button>
              <button
                type="button"
                className="btn btn-sm bg-card"
                onClick={() => setEdit(null)}
              >
                Close
              </button>
              {spots.some((s) => s.id === edit.id) && (
                <button
                  type="button"
                  className="btn btn-sm bg-blush"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${edit.code}? Its printed QR will stop working.`,
                      )
                    ) {
                      deleteSpot(edit.id);
                      setEdit(null);
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        )}

        <div className="card-pop bg-card">
          <h2 className="border-b-2 border-ink px-5 py-3 font-display text-lg font-bold">
            {spots.length} spots
          </h2>
          <ul className="max-h-[560px] divide-y-2 divide-ink/10 overflow-y-auto">
            {zones.map((z) =>
              spots
                .filter((s) => s.zoneId === z.id)
                .map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                    <QrImage
                      value={spotUrl(venue.code, s.code)}
                      size={56}
                      className="rounded border border-ink/20"
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setEdit(s)}
                    >
                      <span className="font-mono font-bold">{s.code}</span>
                      <span className="block truncate text-sm">{s.label}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm bg-card"
                      onClick={() => void downloadQr(venue.code, s.code, s.label)}
                    >
                      PNG
                    </button>
                  </li>
                )),
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- menus */

function MenusTab({ d, venue }: { d: DB; venue: Venue }) {
  const vendors = d.vendors.filter((v) => v.venueId === venue.id);
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground">
          Quick edits for prices and stock. Add new stalls with Menu capture.
        </p>
        <Link to="/admin/capture" className="btn bg-coral">
          + Capture a stall
        </Link>
      </div>
      {vendors.map((v) => (
        <section key={v.id} className="card-pop bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink px-5 py-3">
            <h2 className="font-display text-lg font-bold">
              {v.emoji} {v.name}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · {v.stallLabel}
              </span>
            </h2>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={v.isOpen}
                onChange={(e) =>
                  upsertVendor({ ...v, isOpen: e.target.checked })
                }
              />
              Open
            </label>
          </header>
          <table className="w-full text-sm">
            <tbody>
              {d.products
                .filter((p) => p.vendorId === v.id)
                .map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-ink/10 last:border-0"
                  >
                    <td className="px-5 py-2">
                      <b>{p.name}</b>
                      {p.kind === "service" && (
                        <span className="ml-2 chip">service</span>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        Price checked {p.priceCheckedAt}
                      </span>
                    </td>
                    <td className="w-32 py-2">
                      <input
                        className="field py-1.5"
                        inputMode="numeric"
                        defaultValue={p.priceKobo / 100}
                        aria-label={`${p.name} price in naira`}
                        onBlur={(e) => {
                          const k =
                            Number(e.target.value.replace(/[^\d]/g, "")) * 100;
                          if (k > 0 && k !== p.priceKobo) {
                            upsertProduct({
                              ...p,
                              priceKobo: k,
                              priceCheckedAt: new Date()
                                .toISOString()
                                .slice(0, 10),
                            });
                            toast.success(`${p.name}: ${formatNaira(k)}`);
                          }
                        }}
                      />
                    </td>
                    <td className="w-28 px-3 py-2">
                      <label className="flex items-center gap-2 font-bold">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={p.inStock}
                          onChange={(e) =>
                            upsertProduct({ ...p, inStock: e.target.checked })
                          }
                        />
                        In stock
                      </label>
                    </td>
                    <td className="w-12 pr-4 text-right">
                      <button
                        type="button"
                        aria-label={`Delete ${p.name}`}
                        className="font-bold"
                        onClick={() =>
                          window.confirm(`Delete ${p.name}?`) &&
                          deleteProduct(p.id)
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- floor plan */

function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function PlanTab({ d, venue }: { d: DB; venue: Venue }) {
  const zones = d.zones.filter((z) => z.venueId === venue.id);
  const cal = useGpsCalibration(venue, saveGeo);
  const [pending, setPending] = useState<{ name: string; plan: unknown } | null>(null);
  const [result, setResult] = useState<PlanImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async (name: string, text: string) => {
    setResult(null);
    let plan: unknown;
    try {
      plan = JSON.parse(text);
    } catch {
      setResult({ ok: false, applied: false, errors: [`${name} isn't valid JSON`], warnings: [] });
      return;
    }
    setPending({ name, plan });
    try {
      setResult(await importPlan(plan, true));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await importPlan(pending.plan, false);
      setResult(r);
      if (r.applied) {
        toast.success("Plan applied");
        setPending(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <FloorPlan
        venue={venue}
        zones={zones}
        spots={d.spots.filter((s) => s.venueId === venue.id && s.active)}
        {...(cal.awaitingClick ? { onPlace: cal.place } : {})}
        caption={
          cal.awaitingClick
            ? "Now click the exact place you're standing on the plan."
            : "Dashed outline = approximate, check on the site walk. Hatched = restricted. ⛔ = blocked entrance."
        }
      />
      <div className="grid h-fit gap-4">
        {cal.panel}

        <section className="card-pop bg-card p-5">
          <h2 className="text-xl font-extrabold">Venue plan file</h2>
          <p className="mt-1 text-sm">
            The whole map (floors, zones, halls, QR spots, entrances) lives in
            one file in the <b>layovr-plan/1</b> format. Download it, edit it
            (or start from the template), and upload it back. Re-uploading
            updates things in place; nothing is deleted. Guide:
            docs/PLAN-STANDARD.md.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm bg-card"
              onClick={async () => {
                try {
                  downloadJson(`${venue.code.toLowerCase()}.plan.json`, await exportPlan());
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              ⬇ Current plan
            </button>
            <button
              type="button"
              className="btn btn-sm bg-card"
              onClick={() => downloadJson("venue-plan.template.json", PLAN_TEMPLATE)}
            >
              ⬇ Blank template
            </button>
          </div>
          <label className="mt-4 block text-sm font-bold">
            Upload a plan file
            <input
              type="file"
              accept="application/json,.json"
              className="mt-1 block w-full text-sm"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) await check(file.name, await file.text());
                e.target.value = "";
              }}
            />
          </label>
          {result && (
            <div className="mt-4 grid gap-2 text-sm" aria-live="polite">
              {result.applied ? (
                <p className="font-bold">✅ Applied.</p>
              ) : result.ok ? (
                <p className="font-bold">✅ {pending?.name} looks good.</p>
              ) : (
                <p className="font-bold text-destructive">
                  {pending?.name ?? "The file"} can't be used yet:
                </p>
              )}
              {result.errors.length > 0 && (
                <ul className="list-disc pl-5 text-destructive">
                  {result.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {result.warnings.length > 0 && (
                <details>
                  <summary className="cursor-pointer font-bold">
                    {result.warnings.length} thing{result.warnings.length === 1 ? "" : "s"} to check
                  </summary>
                  <ul className="mt-1 list-disc pl-5">
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              {result.ok && !result.applied && (
                <button
                  type="button"
                  className="btn btn-sm w-fit bg-coral"
                  disabled={busy}
                  onClick={() => void apply()}
                >
                  Apply to {venue.code}
                </button>
              )}
            </div>
          )}
        </section>

        <section className="card-pop bg-card p-5">
          <h2 className="text-xl font-extrabold">Tracing image</h2>
          <p className="mt-1 text-sm">
            Optional: the organiser's drawing, shown faintly under the plan so
            you can line shapes up. It is stretched to the plan's canvas.
          </p>
          <input
            type="file"
            accept="image/*"
            className="mt-3 block w-full text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              updateVenue(venue.id, {
                floorPlanUrl: await compressImage(file, 1600, 0.8),
              });
              toast.success("Tracing image updated");
            }}
          />
          {venue.floorPlanUrl && (
            <button
              type="button"
              className="btn btn-sm mt-3 bg-card"
              onClick={() => updateVenue(venue.id, { floorPlanUrl: "" })}
            >
              Remove image
            </button>
          )}
        </section>

        <section className="card-pop bg-card p-5">
          <h2 className="text-xl font-extrabold">Areas</h2>
          <ul className="mt-3 grid gap-3">
            {zones.map((z) => (
              <li key={z.id} className="flex flex-wrap items-center gap-2">
                <span className="chip w-16 justify-center bg-sun font-mono text-[10px]">
                  {z.code}
                </span>
                <span className="w-14 text-xs font-bold text-muted-foreground">
                  {z.section ?? ""}
                  {z.level ?? "all"}
                  {z.approximate ? " ~" : ""}
                </span>
                <input
                  className="field min-w-0 flex-1 py-2"
                  defaultValue={z.name}
                  onBlur={(e) =>
                    e.target.value !== z.name && updateZone(z.id, { name: e.target.value })
                  }
                  aria-label={`${z.code} name`}
                />
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={z.restricted}
                    onChange={(e) =>
                      updateZone(z.id, { restricted: e.target.checked })
                    }
                  />
                  Restricted
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Orders to restricted areas only go to runners with access (🔑 on the
            ops board). ~ = approximate outline.
          </p>
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- settings */

function SettingsTab({
  venue,
  allowReset,
}: {
  venue: Venue;
  allowReset: boolean;
}) {
  const [pct, setPct] = useState(String(venue.feePct * 100));
  const [flat, setFlat] = useState(String(venue.feeFlatKobo / 100));
  const [absorb, setAbsorb] = useState(String(venue.absorbLimitKobo / 100));
  const preview = {
    ...venue,
    feePct: Number(pct) / 100,
    feeFlatKobo: Number(flat) * 100,
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form
        className="card-pop grid h-fit gap-4 bg-sun p-6"
        onSubmit={(e) => {
          e.preventDefault();
          updateVenue(venue.id, {
            feePct: Number(pct) / 100,
            feeFlatKobo: Math.round(Number(flat) * 100),
            absorbLimitKobo: Math.round(Number(absorb) * 100),
          });
          toast.success("Settings saved");
        }}
      >
        <h2 className="text-xl font-extrabold">Service fee</h2>
        <p className="text-sm">
          Covers the Flutterwave charge plus your markup. Shown as one line at
          checkout.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="% of items">
            <input
              className="field"
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
          </Field>
          <Field label="Flat (₦)">
            <input
              className="field"
              inputMode="numeric"
              value={flat}
              onChange={(e) => setFlat(e.target.value)}
            />
          </Field>
        </div>
        <p className="rounded-xl border-2 border-ink bg-card p-3 text-sm">
          On a ₦3,000 order the fee is{" "}
          <b>
            <Money kobo={feeFor(preview, 300000)} />
          </b>
          ; on ₦10,000 it's{" "}
          <b>
            <Money kobo={feeFor(preview, 1000000)} />
          </b>
          .
        </p>
        <Field
          label="Price changes we absorb (₦)"
          hint="Runners only call the buyer when a stall charges more than this."
        >
          <input
            className="field"
            inputMode="numeric"
            value={absorb}
            onChange={(e) => setAbsorb(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn bg-coral">
          Save
        </button>
      </form>

      {allowReset && (
        <section className="card-pop h-fit bg-card p-6">
          <h2 className="text-xl font-extrabold">Demo data</h2>
          <p className="mt-1 text-sm">
            Data lives in the Layovr database and is shared by every phone.
            Reset deletes all orders, captured menus and photos, and restores
            the sample vendors and spots. Turned off in production.
          </p>
          <button
            type="button"
            className="btn mt-4 bg-blush"
            onClick={async () => {
              if (
                window.confirm(
                  "Reset ALL data for everyone? Orders and captured menus are deleted.",
                ) &&
                (await resetDemo())
              )
                toast.success("Demo data reset");
            }}
          >
            Reset demo data
          </button>
        </section>
      )}
    </div>
  );
}
