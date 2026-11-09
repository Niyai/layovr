import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/ui-bits";
import { papi, queryClient, type PartnerMe } from "@/lib/partnerApi";

export const Route = createFileRoute("/dashboard/signup")({
  head: () => ({ meta: [{ title: "Create a partner account · Layovr" }] }),
  component: Signup,
});

const KINDS = [
  ["event_planner", "Event planner / organiser"],
  ["venue", "Venue or event centre"],
  ["ticketing", "Ticketing or event platform"],
  ["airport", "Airport or mall"],
  ["other", "Something else"],
] as const;

function Signup() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", organisation: "", kind: "event_planner", email: "", password: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:grid-cols-[1.1fr_1fr]">
      <form
        className="card-pop grid h-fit gap-4 bg-sun p-8"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const me = await papi<PartnerMe>("/partner/signup", {
              body: { ...form, ...(form.phone.trim() ? {} : { phone: undefined }) },
            });
            queryClient.setQueryData(["me"], me);
            toast.success(`Welcome, ${me.user.name}`);
            void navigate({ to: "/dashboard/events/new" });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-3xl font-extrabold">Run deliveries at your event</h1>
        <p>Create your organisation's account. It's free to set up an event and map your venue.</p>
        <Field label="Your name">
          <input className="field" value={form.name} onChange={set("name")} autoComplete="name" required />
        </Field>
        <Field label="Organisation">
          <input className="field" value={form.organisation} onChange={set("organisation")} autoComplete="organization" required />
        </Field>
        <Field label="What best describes you?">
          <select className="field" value={form.kind} onChange={set("kind")}>
            {KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Work email">
            <input className="field" type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
          </Field>
          <Field label="Phone" hint="Optional">
            <input className="field" type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" />
          </Field>
        </div>
        <Field label="Password" hint="At least 8 characters">
          <input className="field" type="password" value={form.password} onChange={set("password")} autoComplete="new-password" minLength={8} required />
        </Field>
        <button type="submit" className="btn bg-coral" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className="text-sm">
          Already have an account?{" "}
          <Link to="/dashboard/login" className="font-bold underline">
            Sign in
          </Link>
        </p>
      </form>
      <aside className="card-pop h-fit bg-card p-6">
        <h2 className="text-xl font-extrabold">What you can do</h2>
        <ol className="mt-3 grid list-decimal gap-2 pl-5">
          <li>Create your event and find it on the map.</li>
          <li>Start from a Lagos venue (Landmark, Eko Convention Centre, National Theatre…) or upload your own plan, then edit it.</li>
          <li>Bring your own runners, or ask Layovr to handle deliveries.</li>
          <li>Invite vendors to add their menus, and add your team.</li>
          <li>Print QR cards and publish. Buyers order from their seat.</li>
        </ol>
        <p className="mt-4 text-sm text-muted-foreground">
          Already run your own event app? Connect it through our{" "}
          <Link to="/developers" className="font-bold underline">
            API and MCP server
          </Link>
          .
        </p>
      </aside>
    </div>
  );
}
