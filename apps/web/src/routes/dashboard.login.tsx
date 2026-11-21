import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { signOutPartner } from "@/components/SiteChrome";
import { Field } from "@/components/ui-bits";
import { papi, queryClient, useDemoLogins, useMe, type PartnerMe } from "@/lib/partnerApi";

export const Route = createFileRoute("/dashboard/login")({
  head: () => ({ meta: [{ title: "Partner sign-in · Layovr" }] }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const demo = useDemoLogins();
  const me = useMe().data;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-4 py-10 md:grid-cols-2">
      {me && (
        <div className="card-pop bg-mint p-6 md:col-span-2">
          <p className="flex items-center gap-2 font-bold">
            <span className="h-2.5 w-2.5 rounded-full bg-card ring-2 ring-ink" aria-hidden />
            You're signed in as {me.user.name} ({me.partner.name})
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={me.user.role === "operator" ? "/dashboard/operator" : "/dashboard"} className="btn bg-coral">
              Go to dashboard
            </Link>
            <button type="button" className="btn bg-card" onClick={() => void signOutPartner()}>
              Sign out
            </button>
          </div>
          <p className="mt-3 text-sm">To switch accounts, sign in below.</p>
        </div>
      )}
      <form
        className="card-pop grid h-fit gap-4 bg-sun p-8"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const me = await papi<PartnerMe>("/partner/login", { body: { email, password } });
            queryClient.setQueryData(["me"], me);
            void navigate({ to: me.user.role === "operator" ? "/dashboard/operator" : "/dashboard" });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-3xl font-extrabold">Partner sign-in</h1>
        <p>For event planners, venues and platforms.</p>
        <Field label="Email">
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field label="Password">
          <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <button type="submit" className="btn bg-coral" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-sm">
          New here?{" "}
          <Link to="/dashboard/signup" className="font-bold underline">
            Create an account
          </Link>
          . Event staff (runners, dispatch):{" "}
          <Link to="/staff" className="font-bold underline">
            sign in with your PIN
          </Link>
          .
        </p>
      </form>
      {demo.data && demo.data.length > 0 && (
        <div className="card-pop h-fit bg-card p-6">
          <span className="chip bg-blush">Demo accounts</span>
          <p className="mt-3 text-sm text-muted-foreground">Local development only.</p>
          <ul className="mt-4 divide-y-2 divide-ink/10">
            {demo.data.map((d) => (
              <li key={d.email} className="py-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                  }}
                >
                  <b>{d.label}</b>
                  <span className="block font-mono text-xs">{d.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
