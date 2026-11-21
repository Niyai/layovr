import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FloorPlan } from "@/components/FloorPlan";
import { RequireStaff } from "@/components/RequireStaff";
import { vendorDots } from "@/lib/liveDots";
import { shareVendorLocation, useDB } from "@/lib/store";
import type { Staff } from "@/lib/types";
import { useLiveLocation } from "@/lib/useLiveLocation";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/stall")({
  head: () => ({ meta: [{ title: "My cart · Layovr" }] }),
  component: () => <RequireStaff roles={["vendor"]}>{(me) => <MyCart me={me} />}</RequireStaff>,
});

const SHARE_KEY = "layovr:vendor-share";

/** Vendor staff at a mobile cart: share where the cart is so buyers can find it. */
function MyCart({ me }: { me: Staff }) {
  const d = useDB();
  const vendor = d.vendors.find((v) => v.id === me.vendorId);
  const venue = d.venues.find((v) => v.id === me.venueId);
  const [share, setShare] = useState(() => {
    try {
      return localStorage.getItem(SHARE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const canShare = Boolean(vendor?.mobile && vendor.isOpen);
  const status = useLiveLocation(share && canShare, shareVendorLocation);
  const toggle = () => {
    const next = !share;
    setShare(next);
    try {
      localStorage.setItem(SHARE_KEY, next ? "1" : "0");
    } catch {
      /* private mode: fine, just not remembered */
    }
  };

  if (!vendor || !venue) {
    return <p className="mx-auto max-w-xl p-8">You're not linked to a vendor yet. Ask the event organiser to check your account.</p>;
  }
  const waiting = d.stats.vendorActive[vendor.id] ?? 0;
  const dots = vendorDots(d, venue.id).filter((dot) => dot.id === `v_${vendor.id}`);

  return (
    <div className="mx-auto grid max-w-xl gap-4 px-4 py-6">
      <div>
        <h1 className="text-3xl font-extrabold">
          {vendor.emoji} {vendor.name}
        </h1>
        <p className="text-muted-foreground">
          {venue.name} · {vendor.isOpen ? "open" : "closed"} · {waiting} order{waiting === 1 ? "" : "s"} waiting
        </p>
      </div>

      {!vendor.mobile ? (
        <p className="card-pop bg-card p-4">
          {vendor.name} is a fixed stall, so buyers see it at <b>{vendor.stallLabel}</b>. If you move around the venue, ask the organiser to mark
          it as a mobile cart.
        </p>
      ) : !vendor.isOpen ? (
        <p className="card-pop bg-blush p-4">You're closed, so buyers don't see where you are. Ask the organiser to open you.</p>
      ) : (
        <section className="card-pop grid gap-3 bg-card p-4">
          <h2 className="font-display text-xl font-bold">Show buyers where you are</h2>
          <p className="text-sm">
            While this is on, buyers see your cart move on the event map, with roughly how far away you are. Nothing is kept after you stop.
          </p>
          <button type="button" className={cn("btn", share ? "bg-card" : "bg-mint")} onClick={toggle}>
            {share ? "Stop sharing" : "📡 Start sharing my location"}
          </button>
          {share && (
            <p
              role="status"
              className={cn("rounded-xl border-2 border-ink px-3 py-1.5 text-sm font-semibold", status === "on" ? "bg-mint" : "bg-blush")}
            >
              {status === "on"
                ? "📡 Buyers can see your cart. Keep this page open."
                : status === "denied"
                  ? "📡 Location is blocked. Allow it in your browser settings."
                  : status === "unavailable"
                    ? "📡 Can't get your location right now"
                    : "📡 Finding you…"}
            </p>
          )}
        </section>
      )}

      <FloorPlan
        venue={venue}
        zones={d.zones.filter((z) => z.venueId === venue.id)}
        spots={[]}
        dots={dots}
        caption={dots.length ? `${vendor.emoji} is where buyers see you` : "Your cart shows here once you're sharing and the plan is linked to GPS."}
      />
    </div>
  );
}
