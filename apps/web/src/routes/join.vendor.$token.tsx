import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyCard, Field, Section } from "@/components/ui-bits";
import { papi, type TeamVendor } from "@/lib/partnerApi";

export const Route = createFileRoute("/join/vendor/$token")({
  head: () => ({ meta: [{ title: "Add your menu · Layovr" }] }),
  component: VendorInvite,
});

type Invite = {
  event: { name: string; code: string; startsAt: string | null; address: string | null };
  areas: { id: string; name: string; code: string; location: string }[];
  vendor: TeamVendor;
  expiresAt: string;
};
type Row = { key: number; name: string; price: string; category: string };

let rowKey = 0;
const newRow = (category = "Menu"): Row => ({ key: ++rowKey, name: "", price: "", category });

/** Opened from the invite link an organiser sends: the vendor fills in their own stall and menu. */
function VendorInvite() {
  const { token } = Route.useParams();
  const invite = useQuery({ queryKey: ["invite", token], queryFn: () => papi<Invite>(`/invites/${token}`), retry: false });
  const [done, setDone] = useState<TeamVendor | null>(null);

  if (invite.isError) {
    return (
      <Section>
        <EmptyCard emoji="🔗" title="This link can't be used">
          <p>{invite.error instanceof Error ? invite.error.message : "Ask the organiser for a new link."}</p>
        </EmptyCard>
      </Section>
    );
  }
  if (!invite.data) return <Section><p className="text-center">Loading…</p></Section>;
  if (done) {
    return (
      <Section>
        <EmptyCard emoji="🎉" title={`${done.name} is on Layovr`}>
          <p>
            Your {done.products.length} item{done.products.length === 1 ? "" : "s"} will show to buyers at {invite.data.event.name} once the organiser publishes the event.
            Layovr runners will come to your stall to buy and deliver orders.
          </p>
        </EmptyCard>
      </Section>
    );
  }
  return <Form token={token} invite={invite.data} onDone={setDone} />;
}

function Form({ token, invite, onDone }: { token: string; invite: Invite; onDone: (v: TeamVendor) => void }) {
  const v = invite.vendor;
  const [form, setForm] = useState({
    name: v.name,
    emoji: v.emoji,
    category: v.category,
    description: v.description,
    zoneId: v.zoneId ?? "",
    stallLabel: v.stallLabel,
    contactName: v.contactName ?? "",
    contactPhone: v.contactPhone ?? "",
  });
  const [rows, setRows] = useState<Row[]>([newRow(), newRow(), newRow()]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const items = rows.filter((r) => r.name.trim() && Number(r.price) > 0);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-extrabold">Add your menu</h1>
      <p className="mt-1">
        For <b>{invite.event.name}</b>
        {invite.event.address ? ` at ${invite.event.address}` : ""}. Buyers order from their seats; a Layovr runner comes to your stall, pays and delivers.
      </p>
      <form
        className="mt-6 grid gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await papi<TeamVendor>(`/invites/${token}`, {
              body: {
                vendor: {
                  name: form.name.trim(),
                  emoji: form.emoji || "🍽️",
                  category: form.category.trim() || "Food & drink",
                  description: form.description.trim(),
                  stallLabel: form.stallLabel.trim(),
                  ...(form.zoneId ? { zoneId: form.zoneId } : {}),
                  ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
                  ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
                },
                items: items.map((r) => ({
                  name: r.name.trim(),
                  priceKobo: Math.round(Number(r.price) * 100),
                  category: r.category.trim() || "Menu",
                  kind: "goods",
                  inStock: true,
                  fulfilment: "deliver",
                })),
              },
            });
            onDone(r);
          } catch (x) {
            toast.error(x instanceof Error ? x.message : String(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <section className="card-pop grid gap-3 bg-card p-5">
          <h2 className="text-xl font-extrabold">1. Your stall</h2>
          <div className="grid grid-cols-[4rem_1fr] gap-2">
            <Field label="Icon">
              <input className="field text-center" value={form.emoji} onChange={set("emoji")} maxLength={4} />
            </Field>
            <Field label="Stall name">
              <input className="field" value={form.name} onChange={set("name")} required />
            </Field>
          </div>
          <Field label="What you sell">
            <input className="field" value={form.category} onChange={set("category")} placeholder="Rice & mains, drinks, suya…" />
          </Field>
          <Field label="Area" hint="Where your stall is at the event">
            <select className="field" value={form.zoneId} onChange={set("zoneId")}>
              <option value="">I don't know yet</option>
              {invite.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.location ? ` (${a.location})` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Where exactly" hint="So runners can find you">
            <input className="field" value={form.stallLabel} onChange={set("stallLabel")} placeholder="Food village, second row, blue tent" required />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Contact name">
              <input className="field" value={form.contactName} onChange={set("contactName")} />
            </Field>
            <Field label="Phone" hint="Only the organiser sees this">
              <input className="field" type="tel" value={form.contactPhone} onChange={set("contactPhone")} />
            </Field>
          </div>
        </section>
        <section className="card-pop grid gap-3 bg-card p-5">
          <h2 className="text-xl font-extrabold">2. Items and prices</h2>
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[1fr_6rem] gap-2 sm:grid-cols-[1fr_7rem_8rem]">
              <input className="field" placeholder={`Item ${i + 1}`} value={r.name} aria-label={`Item ${i + 1} name`} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))} />
              <input className="field" placeholder="₦" inputMode="numeric" value={r.price} aria-label={`Item ${i + 1} price in naira`} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, price: e.target.value.replace(/[^\d]/g, "") } : x)))} />
              <input className="field col-span-2 sm:col-span-1" placeholder="Section" value={r.category} aria-label={`Item ${i + 1} section`} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, category: e.target.value } : x)))} />
            </div>
          ))}
          <button type="button" className="btn btn-sm w-fit bg-card" onClick={() => setRows([...rows, newRow(rows.at(-1)?.category)])}>
            + Another item
          </button>
        </section>
        <button type="submit" className="btn bg-coral" disabled={busy || !form.name.trim() || !form.stallLabel.trim()}>
          {busy ? "Saving…" : `Save stall${items.length ? ` and ${items.length} item${items.length === 1 ? "" : "s"}` : ""}`}
        </button>
        <p className="text-center text-xs text-muted-foreground">This link works once and expires {new Date(invite.expiresAt).toLocaleDateString("en-NG")}.</p>
      </form>
    </div>
  );
}
