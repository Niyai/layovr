import type { MouseEvent, ReactNode } from "react";
import type { Spot, Venue, Zone } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PlanDot = {
  id: string;
  x: number;
  y: number;
  className: string;
  label: string;
};

/**
 * A venue floor plan. Uses the uploaded plan image when there is one,
 * otherwise draws the schematic zone rectangles. Coordinates are % of the
 * plan's width and height, so spots stay put if the image is swapped for a
 * same-shaped one.
 */
export function FloorPlan({
  venue,
  zones,
  spots,
  highlightSpotId,
  dots = [],
  onPlace,
  onSpotClick,
  caption,
  className,
}: {
  venue: Venue;
  zones: Zone[];
  spots: Spot[];
  highlightSpotId?: string;
  dots?: PlanDot[];
  onPlace?: (x: number, y: number) => void;
  onSpotClick?: (spot: Spot) => void;
  caption?: ReactNode;
  className?: string;
}) {
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onPlace) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    onPlace(x, y);
  };

  return (
    <figure className={cn("card-pop overflow-hidden bg-card", className)}>
      <div
        className={cn(
          "relative aspect-[4/3] w-full select-none bg-muted",
          onPlace && "cursor-crosshair",
        )}
        onClick={handleClick}
        role={onPlace ? "button" : undefined}
        aria-label={
          onPlace
            ? "Floor plan: click to place a spot"
            : `Floor plan of ${venue.name}`
        }
      >
        {venue.floorPlanUrl ? (
          <img
            src={venue.floorPlanUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-fill"
          />
        ) : (
          zones.map((z) => (
            <div
              key={z.id}
              className={cn(
                "absolute flex items-start justify-center rounded-xl border-2 border-ink pt-1 text-center",
                z.restricted
                  ? "bg-blush/60 [background-image:repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,.06)_6px,rgba(0,0,0,.06)_12px)]"
                  : "bg-cream",
              )}
              style={{
                left: `${z.rect.x}%`,
                top: `${z.rect.y}%`,
                width: `${z.rect.w}%`,
                height: `${z.rect.h}%`,
              }}
            >
              <span className="px-1 font-display text-[11px] font-bold leading-tight sm:text-sm">
                {z.name}
                {z.restricted && (
                  <span className="block text-[10px] font-semibold">
                    restricted
                  </span>
                )}
              </span>
            </div>
          ))
        )}

        {spots.map((s) => {
          const on = s.id === highlightSpotId;
          return (
            <button
              key={s.id}
              type="button"
              title={`${s.code} · ${s.label}`}
              aria-label={`Spot ${s.code}: ${s.label}`}
              onClick={(e) => {
                e.stopPropagation();
                onSpotClick?.(s);
              }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink font-mono text-[9px] font-bold leading-none transition",
                on
                  ? "z-20 bg-coral px-1.5 py-1 text-xs shadow-pop ring-4 ring-coral/30"
                  : "z-10 bg-sun px-1 py-0.5",
                !onSpotClick && "pointer-events-none",
              )}
              style={{ left: `${s.x}%`, top: `${s.y}%` }}
            >
              {on ? `📍 ${s.code}` : s.code}
            </button>
          );
        })}

        {dots.map((d, i) => (
          <span
            key={d.id}
            title={d.label}
            className={cn(
              "absolute z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink",
              d.className,
            )}
            style={{
              left: `calc(${d.x}% + ${(i % 3) * 6 - 6}px)`,
              top: `calc(${d.y}% - 14px)`,
            }}
          />
        ))}
      </div>
      {caption && (
        <figcaption className="border-t-2 border-ink px-4 py-2 text-sm">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
