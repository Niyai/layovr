import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { STAFF_HOME, signOutStaff } from "@/components/SiteChrome";
import { Field } from "@/components/ui-bits";
import { staffLogin, useDB, useHydrated } from "@/lib/store";

export const Route = createFileRoute("/staff")({
  head: () => ({ meta: [{ title: "Staff sign-in · Layovr" }] }),
  component: StaffLogin,
});


function StaffLogin() {
  const d = useDB();
  const hydrated = useHydrated();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [eventCode, setEventCode] = useState(() => {
    try {
      return window.localStorage.getItem("layovr:staff-event") ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const demo = d.config.demoAccounts;
  const me = d.me;

  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-4 py-12 md:grid-cols-2">
      {me && (
        <div className="card-pop bg-mint p-6 md:col-span-2">
          <p className="flex items-center gap-2 font-bold">
            <span className="h-2.5 w-2.5 rounded-full bg-card ring-2 ring-ink" aria-hidden />
            You're signed in as {me.name} ({me.role})
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn bg-coral" onClick={() => void navigate({ to: STAFF_HOME[me.role] })}>
              Go to my screen
            </button>
            <button type="button" className="btn bg-card" onClick={() => void signOutStaff()}>
              Sign out
            </button>
          </div>
          <p className="mt-3 text-sm">To switch to someone else, sign in below.</p>
        </div>
      )}
      <form
        className="card-pop h-fit bg-sun p-8"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const me = await staffLogin(eventCode, pin);
          try {
            window.localStorage.setItem("layovr:staff-event", eventCode.trim().toUpperCase());
          } catch {
            // ignore
          }
          setBusy(false);
          if (!me) {
            toast.error("That event code and PIN don't match anyone.");
            return;
          }
          toast.success(`Hi ${me.name}`);
          void navigate({ to: STAFF_HOME[me.role] });
        }}
      >
        <h1 className="text-3xl font-extrabold">Staff sign-in</h1>
        <p className="mt-1">
          Ops, runners, admin and menu capture. Organising an event?{" "}
          <a href="/dashboard/login" className="font-bold underline">
            Partner dashboard
          </a>
        </p>
        <div className="mt-6 grid gap-4">
          <Field label="Event code" hint="From your organiser, e.g. MOONSHOT">
            <input
              className="field font-mono uppercase tracking-wider"
              value={eventCode}
              onChange={(e) => setEventCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
            />
          </Field>
          <Field label="Your PIN">
            <input
              className="field text-center font-mono text-2xl tracking-[0.4em]"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </Field>
        </div>
        <button
          type="submit"
          className="btn mt-6 w-full bg-coral"
          disabled={pin.length < 4 || eventCode.trim().length < 2 || busy}
        >
          Sign in
        </button>
      </form>

      {hydrated && demo.length > 0 && (
        <div className="card-pop h-fit bg-card p-6">
          <span className="chip bg-blush">Demo accounts</span>
          <p className="mt-3 text-sm text-muted-foreground">
            Shown because the API runs with SHOW_DEMO_PINS on (local dev only).
            Production hides this list.
          </p>
          <ul className="mt-4 divide-y-2 divide-ink/10">
            {demo.map((s) => (
              <li key={s.pin} className="flex items-center justify-between py-2">
                <span>
                  <b>{s.name}</b> · {s.role}
                </span>
                <button
                  type="button"
                  className="font-mono font-bold underline"
                  onClick={() => {
                    setEventCode(s.eventCode);
                    setPin(s.pin);
                  }}
                >
                  {s.eventCode} · {s.pin}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
