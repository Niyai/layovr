import { Link, useNavigate, useRouterState, type LinkOptions } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { partnerLogout, useMe } from "@/lib/partnerApi";
import { staffLogout, useDB, useSession } from "@/lib/store";
import type { StaffRole } from "@/lib/types";
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
  { label: "Developers", link: { to: "/developers" } },
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
          <AccountMenu />
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
            ["/dashboard/login", "Partner dashboard"],
            ["/developers", "API & MCP docs"],
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

export const STAFF_NAV = [
  { to: "/ops", label: "Ops board", roles: ["admin", "dispatch"] },
  { to: "/runner", label: "Runner", roles: ["admin", "dispatch", "runner"] },
  { to: "/admin", label: "Admin", roles: ["admin"] },
  { to: "/seats", label: "Seats", roles: ["admin", "dispatch"] },
  { to: "/admin/capture", label: "Menu capture", roles: ["admin", "capture"] },
  { to: "/stall", label: "My cart", roles: ["vendor"] },
] as const;

/** Where each staff role lands after signing in. */
export const STAFF_HOME: Record<
  StaffRole,
  "/admin" | "/ops" | "/runner" | "/admin/capture" | "/stall"
> = {
  admin: "/admin",
  dispatch: "/ops",
  runner: "/runner",
  capture: "/admin/capture",
  vendor: "/stall",
};

export async function signOutStaff() {
  await staffLogout();
  toast.success("Signed out");
}

export async function signOutPartner() {
  await partnerLogout();
  toast.success("Signed out of the partner dashboard");
}

/** Green "signed in" dot plus who it is; first name only on small screens. */
export function SignedInLabel({ name, detail }: { name: string; detail: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-mint ring-2 ring-mint/30" aria-hidden />
      <span className="sr-only">Signed in as </span>
      <span className="font-semibold sm:hidden">{name.split(" ")[0]}</span>
      <span className="hidden opacity-80 sm:inline">
        {name} · {detail}
      </span>
    </span>
  );
}

/**
 * Public header account button: "Sign in" with a choice of staff or partner
 * sign-in, or who is signed in with their screens and Sign out.
 */
function AccountMenu() {
  const d = useDB();
  const staff = d.me;
  const partner = useMe().data ?? null;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = staff?.name ?? partner?.user.name;
  const close = () => setOpen(false);
  const item = "block rounded-xl px-3 py-2 font-semibold hover:bg-muted";

  return (
    <div className="sm:relative" ref={ref}>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-card px-3 py-2 text-sm font-bold"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {name ? (
          <>
            <span className="h-2.5 w-2.5 rounded-full bg-mint ring-2 ring-ink" aria-hidden />
            <span className="sr-only">Signed in as </span>
            <span className="max-w-[7rem] truncate">{name.split(" ")[0]}</span>
          </>
        ) : (
          "Sign in"
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute inset-x-4 top-full z-50 mt-2 rounded-2xl sm:inset-x-auto sm:right-0 sm:w-72 border-2 border-ink bg-card p-2 text-sm shadow-pop"
        >
          {staff && (
            <div className="grid gap-0.5 p-1">
              <p className="px-3 py-1 text-xs text-muted-foreground">
                Signed in as event staff
              </p>
              <p className="px-3 pb-1">
                <b>{staff.name}</b> · {staff.role}
                {d.venues.find((v) => v.id === staff.venueId)?.code && (
                  <> · {d.venues.find((v) => v.id === staff.venueId)?.code}</>
                )}
              </p>
              {STAFF_NAV.filter((n) => (n.roles as readonly string[]).includes(staff.role)).map((n) => (
                <Link key={n.to} to={n.to} role="menuitem" className={item} onClick={close}>
                  {n.label}
                </Link>
              ))}
              <button
                type="button"
                role="menuitem"
                className={cn(item, "text-left text-destructive")}
                onClick={() => {
                  close();
                  void signOutStaff();
                }}
              >
                Sign out
              </button>
            </div>
          )}
          {staff && partner && <hr className="my-1 border-ink/10" />}
          {partner && (
            <div className="grid gap-0.5 p-1">
              <p className="px-3 py-1 text-xs text-muted-foreground">
                Signed in to the partner dashboard
              </p>
              <p className="px-3 pb-1">
                <b>{partner.user.name}</b> · {partner.partner.name}
              </p>
              <Link to="/dashboard" role="menuitem" className={item} onClick={close}>
                Events
              </Link>
              <Link to="/dashboard/keys" role="menuitem" className={item} onClick={close}>
                API & MCP
              </Link>
              <button
                type="button"
                role="menuitem"
                className={cn(item, "text-left text-destructive")}
                onClick={() => {
                  close();
                  void signOutPartner().then(() => navigate({ to: "/dashboard/login" }));
                }}
              >
                Sign out
              </button>
            </div>
          )}
          {!staff && !partner && (
            <div className="grid gap-0.5 p-1">
              <Link to="/staff" role="menuitem" className={item} onClick={close}>
                Event staff
                <span className="block text-xs font-normal text-muted-foreground">
                  Runners, dispatch, admin, vendors: event code + PIN
                </span>
              </Link>
              <Link to="/dashboard/login" role="menuitem" className={item} onClick={close}>
                Partner dashboard
                <span className="block text-xs font-normal text-muted-foreground">
                  Event planners and venues: email + password
                </span>
              </Link>
              <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">
                Ordering? You don't need an account.{" "}
                <Link to="/track" className="font-semibold underline" onClick={close}>
                  Track an order
                </Link>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function StaffHeader() {
  const d = useDB();
  const me = d.me;
  const seatWaiting = d.seatRequests.filter((r) => r.status === "pending").length;
  const navigate = useNavigate();
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
                {n.to === "/seats" && seatWaiting > 0 && (
                  <span className="ml-1 rounded-full bg-coral px-1.5 text-xs text-ink">{seatWaiting}</span>
                )}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2 text-sm">
          {me ? (
            <>
              <SignedInLabel name={me.name} detail={me.role} />
              <button
                type="button"
                className="rounded-full border-2 border-ink-foreground/40 px-3 py-1 font-semibold"
                onClick={() => void signOutStaff().then(() => navigate({ to: "/staff" }))}
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
