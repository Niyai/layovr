import { Link, useRouterState, type LinkOptions } from "@tanstack/react-router";
import { useState } from "react";
import { staffLogout, useDB, useSession } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV: { label: string; link: LinkOptions }[] = [
  { label: "How it works", link: { to: "/how-it-works" } },
  { label: "Scan a code", link: { to: "/scan" } },
  { label: "Explore", link: { to: "/explore" } },
  { label: "Track order", link: { to: "/track" } },
  {
    label: "For vendors",
    link: { to: "/$page", params: { page: "become-a-vendor" } },
  },
  { label: "Partners", link: { to: "/$page", params: { page: "partners" } } },
];

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        "flex items-center gap-2 font-display text-2xl font-extrabold",
        className,
      )}
      aria-label="Layovr home"
    >
      <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-ink bg-sun shadow-pop">
        <span className="h-3 w-3 rounded-full bg-coral ring-2 ring-ink" />
      </span>
      layovr
    </Link>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const session = useSession();
  const count = session.cart.reduce((n, l) => n + l.qty, 0);

  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink bg-cream/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.label}
              {...n.link}
              className="rounded-full px-3 py-2 text-sm font-semibold hover:bg-muted"
              activeProps={{ className: "bg-sun", "aria-current": "page" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            to="/checkout"
            className="relative rounded-full border-2 border-ink bg-card px-3 py-2 text-sm font-bold"
            aria-label={`Basket with ${count} items`}
          >
            🛍️ <span className="ml-1">{count}</span>
          </Link>
          <Link
            to="/explore"
            className="btn hidden bg-coral py-2 text-sm sm:inline-flex"
          >
            Find vendors
          </Link>
          <button
            type="button"
            className="rounded-full border-2 border-ink bg-card px-3 py-2 font-bold lg:hidden"
            aria-expanded={open}
            aria-label="Toggle menu"
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
      </div>
      {open && (
        <nav
          className="border-t-2 border-ink bg-cream px-5 py-3 lg:hidden"
          aria-label="Mobile"
        >
          <ul className="grid gap-1">
            {NAV.map((n) => (
              <li key={n.label}>
                <Link
                  {...n.link}
                  onClick={() => setOpen(false)}
                  className="block rounded-full px-3 py-2 font-semibold hover:bg-muted"
                  activeProps={{ className: "bg-sun" }}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t-2 border-ink bg-ink text-ink-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-4">
        <div>
          <div className="font-display text-3xl font-extrabold text-sun">
            layovr
          </div>
          <p className="mt-3 text-sm opacity-80">
            Making it easy to find the good stuff that's already right around
            you.
          </p>
        </div>
        <FooterCol
          title="Discover"
          links={[
            ["/scan", "Scan a code"],
            ["/explore", "Explore vendors"],
            ["/track", "Track an order"],
            ["/how-it-works", "How it works"],
          ]}
        />
        <FooterCol
          title="Work with us"
          links={[
            ["/become-a-vendor", "Become a vendor"],
            ["/partners", "Partner with Layovr"],
            ["/staff", "Staff sign-in"],
          ]}
        />
        <FooterCol
          title="Support"
          links={[
            ["/help", "Help centre"],
            ["/privacy", "Privacy policy"],
            ["/terms", "Terms of service"],
          ]}
        />
      </div>
      <div className="border-t border-ink-foreground/20 px-5 py-5 text-center text-xs opacity-70">
        © {new Date().getFullYear()} Layovr, made with love for local businesses
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: [string, string][];
}) {
  return (
    <div>
      <h3 className="font-display text-lg font-bold text-sun">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map(([to, label]) => (
          <li key={to}>
            <a
              className="opacity-80 hover:underline hover:opacity-100"
              href={to}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STAFF_NAV = [
  { to: "/ops", label: "Ops board", roles: ["admin", "dispatch"] },
  { to: "/runner", label: "Runner", roles: ["admin", "dispatch", "runner"] },
  { to: "/admin", label: "Admin", roles: ["admin"] },
  { to: "/admin/capture", label: "Menu capture", roles: ["admin", "capture"] },
] as const;

export function StaffHeader() {
  const me = useDB().me;
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink bg-ink text-ink-foreground print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Logo className="text-xl text-ink-foreground" />
          <span className="chip bg-sun text-ink">Staff</span>
        </div>
        {me && (
          <nav className="flex flex-wrap items-center gap-1" aria-label="Staff">
            {STAFF_NAV.filter((n) =>
              (n.roles as readonly string[]).includes(me.role),
            ).map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-ink-foreground/10",
                  path === n.to && "bg-sun text-ink hover:bg-sun",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2 text-sm">
          {me ? (
            <>
              <span className="opacity-80">
                {me.name} · {me.role}
              </span>
              <button
                type="button"
                className="rounded-full border-2 border-ink-foreground/40 px-3 py-1 font-semibold"
                onClick={() => void staffLogout()}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              to="/staff"
              className="rounded-full border-2 border-ink-foreground/40 px-3 py-1 font-semibold"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
