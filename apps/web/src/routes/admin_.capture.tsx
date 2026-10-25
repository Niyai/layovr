import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RequireStaff } from "@/components/RequireStaff";
import { Field } from "@/components/ui-bits";
import {
  formatNaira,
  uid,
  upsertProduct,
  upsertVendor,
  useDB,
} from "@/lib/store";
import type { DB, Fill, Fulfilment, Product, Staff, Vendor } from "@/lib/types";
import { cn, compressImage, fillClass } from "@/lib/utils";

/**
 * Menu capture: our staff record a stall, its items and prices from a phone,
 * standing at the stall. Vendors don't need an account. Target: 5 minutes.
 */
export const Route = createFileRoute("/admin_/capture")({
  head: () => ({ meta: [{ title: "Menu capture · Layovr" }] }),
  component: () => (
    <RequireStaff roles={["admin", "capture"]}>
      {(me) => <Capture me={me} />}
    </RequireStaff>
  ),
});

const EMOJI = [
  "🍛",
  "🥟",
  "🍢",
  "🧃",
  "☕",
  "🍔",
  "🍕",
  "🌯",
  "🍦",
  "🍰",
  "🍺",
  "🔋",
  "👕",
  "📚",
  "🛒",
  "✨",
];
const FILLS: Fill[] = ["sun", "coral", "mint", "lilac", "blush", "card"];

type Row = {
  key: string;
  name: string;
  price: string;
  category: string;
  service: boolean;
  fulfilment: Fulfilment;
  duration: string;
  image?: string;
  age: boolean;
};
const newRow = (category = "Menu"): Row => ({
  key: uid("r"),
  name: "",
  price: "",
  category,
  service: false,
  fulfilment: "deliver",
  duration: "",
  age: false,
});

function Capture({ me }: { me: Staff }) {
  const d = useDB();
  const zones = d.zones.filter((z) => z.venueId === me.venueId);
  const vendors = d.vendors.filter((v) => v.venueId === me.venueId);
  const [vendorId, setVendorId] = useState<string>("new");
  const existing = vendors.find((v) => v.id === vendorId);

  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <h1 className="text-3xl font-extrabold">Menu capture</h1>
      <p className="text-muted-foreground">
        Record a stall in about 5 minutes. It goes live for buyers as soon as
        you save.
      </p>
      <div className="mt-5">
        <Field label="Stall">
          <select
            className="field"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
          >
            <option value="new">+ New stall</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.emoji} {v.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <CaptureForm
        key={vendorId}
        d={d}
        me={me}
        zones={zones}
        existing={existing}
        onSaved={(id) => setVendorId(id)}
      />
    </div>
  );
}

function CaptureForm({
  d,
  me,
  zones,
  existing,
  onSaved,
}: {
  d: DB;
  me: Staff;
  zones: DB["zones"];
  existing: Vendor | undefined;
  onSaved: (vendorId: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [emoji, setEmoji] = useState(existing?.emoji ?? "🍛");
  const [fill, setFill] = useState<Fill>(existing?.fill ?? "sun");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [zoneId, setZoneId] = useState(existing?.zoneId ?? zones[0]?.id ?? "");
  const [stall, setStall] = useState(existing?.stallLabel ?? "");
  const [prep, setPrep] = useState(String(existing?.prepMinutes ?? 8));
  const [rows, setRows] = useState<Row[]>([newRow(), newRow(), newRow()]);
  const current = existing
    ? d.products.filter((p) => p.vendorId === existing.id)
    : [];

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = () => {
    if (!name.trim() || !stall.trim()) {
      toast.error("Add the stall name and where it is.");
      return;
    }
    const vendor: Vendor = {
      id: existing?.id ?? uid("vd"),
      venueId: me.venueId,
      name: name.trim(),
      emoji,
      fill,
      category: category.trim() || "Food & drink",
      description: description.trim(),
      stallLabel: stall.trim(),
      prepMinutes: Number(prep) || 8,
      isOpen: existing?.isOpen ?? true,
      ...(zoneId ? { zoneId } : {}),
    };
    upsertVendor(vendor);
    const today = new Date().toISOString().slice(0, 10);
    const filled = rows.filter((r) => r.name.trim() && Number(r.price) > 0);
    for (const r of filled) {
      const p: Product = {
        id: uid("p"),
        vendorId: vendor.id,
        category: r.category.trim() || "Menu",
        kind: r.service ? "service" : "goods",
        name: r.name.trim(),
        priceKobo: Math.round(Number(r.price) * 100),
        priceCheckedAt: today,
        inStock: true,
        fulfilment: r.service ? r.fulfilment : "deliver",
        ...(r.service && Number(r.duration) > 0
          ? { durationMin: Number(r.duration) }
          : {}),
        ...(r.image ? { imageUrl: r.image } : {}),
        ...(r.age ? { ageRestricted: true } : {}),
      };
      upsertProduct(p);
    }
    toast.success(
      `${vendor.name} saved with ${filled.length} new item${filled.length === 1 ? "" : "s"}`,
    );
    setRows([
      newRow(rows.at(-1)?.category),
      newRow(rows.at(-1)?.category),
      newRow(rows.at(-1)?.category),
    ]);
    onSaved(vendor.id);
  };

  return (
    <form
      className="mt-5 grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <section className="card-pop grid gap-4 bg-card p-5">
        <h2 className="text-xl font-extrabold">1. The stall</h2>
        <Field label="Name">
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mama Put Express"
          />
        </Field>
        <div>
          <span className="mb-1.5 block text-sm font-bold">
            Icon and colour
          </span>
          <div className="flex flex-wrap gap-1.5">
            {EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={emoji === e}
                onClick={() => setEmoji(e)}
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-full border-2 border-ink text-xl",
                  emoji === e ? "bg-sun shadow-pop" : "bg-card",
                )}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {FILLS.map((f) => (
              <button
                key={f}
                type="button"
                aria-label={f}
                aria-pressed={fill === f}
                onClick={() => setFill(f)}
                className={cn(
                  "h-8 w-8 rounded-full border-2 border-ink",
                  fillClass[f],
                  fill === f && "ring-4 ring-ink/30",
                )}
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="What they sell">
            <input
              className="field"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Rice & mains"
            />
          </Field>
          <Field label="Typical wait (min)">
            <input
              className="field"
              inputMode="numeric"
              value={prep}
              onChange={(e) => setPrep(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
        </div>
        <Field label="One-line description" hint="Optional">
          <input
            className="field"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Zone">
            <select
              className="field"
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Where exactly">
            <input
              className="field"
              value={stall}
              onChange={(e) => setStall(e.target.value)}
              placeholder="Left of the stairs"
            />
          </Field>
        </div>
      </section>

      {current.length > 0 && (
        <section className="card-pop bg-mint p-5">
          <h2 className="text-lg font-extrabold">
            Already on the menu ({current.length})
          </h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {current.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.name}</span>
                <span>{formatNaira(p.priceKobo)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            Change prices and stock from Admin → Menus.
          </p>
        </section>
      )}

      <section className="card-pop grid gap-4 bg-card p-5">
        <h2 className="text-xl font-extrabold">2. Items and prices</h2>
        {rows.map((r, i) => (
          <div
            key={r.key}
            className={cn(
              "grid gap-2 rounded-2xl border-2 border-ink/20 p-3",
              r.service && "bg-lilac/30",
            )}
          >
            <div className="flex gap-2">
              <input
                className="field flex-1"
                placeholder={`Item ${i + 1}`}
                value={r.name}
                onChange={(e) => update(r.key, { name: e.target.value })}
                aria-label={`Item ${i + 1} name`}
              />
              <input
                className="field w-28"
                inputMode="numeric"
                placeholder="₦"
                value={r.price}
                onChange={(e) =>
                  update(r.key, { price: e.target.value.replace(/[^\d]/g, "") })
                }
                aria-label={`Item ${i + 1} price in naira`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                className="field w-36 py-1.5"
                placeholder="Section"
                value={r.category}
                onChange={(e) => update(r.key, { category: e.target.value })}
                aria-label="Menu section"
              />
              <label className="flex items-center gap-1.5 font-bold">
                <input
                  type="checkbox"
                  checked={r.service}
                  onChange={(e) =>
                    update(r.key, {
                      service: e.target.checked,
                      fulfilment: e.target.checked
                        ? "collect_and_return"
                        : "deliver",
                    })
                  }
                />
                Service
              </label>
              <label className="flex items-center gap-1.5 font-bold">
                <input
                  type="checkbox"
                  checked={r.age}
                  onChange={(e) => update(r.key, { age: e.target.checked })}
                />
                18+
              </label>
              <label className="cursor-pointer font-bold underline">
                {r.image ? "📷 ✓" : "📷 Photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      update(r.key, {
                        image: await compressImage(file, 600, 0.7),
                      });
                  }}
                />
              </label>
            </div>
            {r.service && (
              <div className="flex flex-wrap gap-2 text-sm">
                <select
                  className="field w-auto py-1.5"
                  value={r.fulfilment}
                  onChange={(e) =>
                    update(r.key, { fulfilment: e.target.value as Fulfilment })
                  }
                  aria-label="How it's fulfilled"
                >
                  <option value="collect_and_return">
                    We collect & return (e.g. charging)
                  </option>
                  <option value="reserve_slot">
                    Buyer goes to the stall at a time
                  </option>
                </select>
                <input
                  className="field w-28 py-1.5"
                  inputMode="numeric"
                  placeholder="Minutes"
                  value={r.duration}
                  onChange={(e) =>
                    update(r.key, {
                      duration: e.target.value.replace(/\D/g, ""),
                    })
                  }
                  aria-label="Duration in minutes"
                />
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm bg-card"
          onClick={() => setRows((rs) => [...rs, newRow(rs.at(-1)?.category)])}
        >
          + Another item
        </button>
      </section>

      <button type="submit" className="btn sticky bottom-4 bg-coral text-lg">
        Save {existing ? "changes" : "stall"} · goes live now
      </button>
    </form>
  );
}
