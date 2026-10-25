import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useDB, useHydrated } from "@/lib/store";
import type { Staff, StaffRole } from "@/lib/types";

/**
 * Gate for staff screens. The real protection is on the API: it only returns
 * orders a role may see and rejects actions from the wrong role.
 */
export function RequireStaff({
  roles,
  children,
}: {
  roles: StaffRole[];
  children: (me: Staff) => ReactNode;
}) {
  const me = useDB().me;
  const hydrated = useHydrated();

  if (!hydrated) return <p className="p-8 text-center">Loading…</p>;
  if (!me || !roles.includes(me.role)) {
    return (
      <div className="mx-auto max-w-md p-8">
        <div className="card-pop bg-card p-8 text-center">
          <div className="text-5xl">🔒</div>
          <h1 className="mt-3 text-2xl font-extrabold">
            {me ? "This screen isn't for your role" : "Staff sign-in needed"}
          </h1>
          <Link to="/staff" className="btn mt-6 bg-coral">
            {me ? "Switch account" : "Sign in"}
          </Link>
        </div>
      </div>
    );
  }
  return <>{children(me)}</>;
}
