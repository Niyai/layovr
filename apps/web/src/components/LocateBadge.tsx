import type { Pinpoint } from "@/lib/types";

/** How the buyer told us where they are, for runner and ops cards. */
export function LocateBadge({ pinpoint }: { pinpoint?: Pinpoint | undefined }) {
  if (!pinpoint) return null;
  const text =
    pinpoint.method === "qr"
      ? "📷 Scanned the QR here"
      : pinpoint.method === "map"
        ? "📌 Tapped this spot on the map"
        : pinpoint.method === "gps"
          ? `📡 Phone location, ±${pinpoint.accuracyM ?? "?"} m`
          : pinpoint.method === "seat"
            ? "🎟️ Their seat, from their ticket (see the note)"
            : "📋 Chose this spot from the list";
  return <p className="text-xs font-semibold text-muted-foreground">{text}</p>;
}
