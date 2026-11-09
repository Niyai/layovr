import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Logo } from "@/components/SiteChrome";
import { papi, queryClient, useMe, type PartnerMe } from "@/lib/partnerApi";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Events" },
  { to: "/dashboard/keys", label: "API & MCP" },
  { to: "/developers", label: "Docs" },
] as const;

export function DashboardHeader() {
  const me = useMe();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const signedIn = me.data;

  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink bg-ink text-ink-foreground print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Logo className="text-xl text-ink-foreground" />
          <span className="chip bg-mint text-ink">Partners</span>
        </div>
        {signedIn && (
          <nav className="flex flex-wrap items-center gap-1" aria-label="Dashboard">
            {[...NAV, ...(signedIn.user.role === "operator" ? [{ to: "/dashboard/operator", label: "Runner requests" } as const] : [])].map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-ink-foreground/10",
                  (path === n.to || (n.to === "/dashboard" && path.startsWith("/dashboard/events"))) && "bg-sun text-ink hover:bg-sun",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2 text-sm">
          {signedIn ? (
            <>
              <span className="opacity-80">
                {signedIn.user.name} · {signedIn.partner.name}
              </span>
              <button
                type="button"
                className="rounded-full border-2 border-ink-foreground/40 px-3 py-1 font-semibold"
                onClick={async () => {
                  await papi("/partner/logout", { body: {} }).catch(() => undefined);
                  queryClient.clear();
                  void navigate({ to: "/dashboard/login" });
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link to="/dashboard/login" className="rounded-full border-2 border-ink-foreground/40 px-3 py-1 font-semibold">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/** Dashboard pages: wait for the partner session; send signed-out visitors to sign in. */
export function RequirePartner({ children }: { children: (me: PartnerMe) => ReactNode }) {
  const me = useMe();
  const navigate = useNavigate();
  useEffect(() => {
    if (me.isError) void navigate({ to: "/dashboard/login", replace: true });
  }, [me.isError]);
  if (!me.data) return <p className="p-8 text-center">Loading…</p>;
  return <>{children(me.data)}</>;
}
