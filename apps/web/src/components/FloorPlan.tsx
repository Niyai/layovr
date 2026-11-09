import { MARKER_KINDS, shapeCentre, shapePath, shapeSize } from "@layovr/shared";
import { useState, type MouseEvent, type ReactNode } from "react";
import type { Spot, Venue, Zone } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PlanDot = {
  id: string;
  x: number;
  y: number;
  className: string;
  label: string;
  /** Floor the dot is on; absent = show on every floor. */
  level?: number;
  /** Show an icon with a caption (e.g. 🛵 Kemi) instead of a plain dot. */
  icon?: string;
};

const MARKER_ICON: Record<keyof typeof MARKER_KINDS, string> = {
  entrance: "🚪",
  stairs: "🪜",
  lift: "🛗",
  escalator: "↗",
  ops_desk: "🧭",
  toilet: "🚻",
  first_aid: "⛑️",
  security: "🛂",
  info: "ℹ️",
};

/** Canvas and floors for a venue, with sensible defaults for venues without a plan file. */
export function planFrame(venue: Venue, zones: Zone[]) {
  const canvas = venue.plan?.canvas ?? { width: 100, height: 75 };
  const levels =
    venue.plan?.levels ??
    [...new Set(zones.flatMap((z) => (z.level === undefined ? [] : [z.level])))]
      .sort((a, b) => a - b)
      .map((level) => ({ level, name: level === 0 ? "Ground floor" : `Level ${level}` }));
  return { canvas, levels: levels.length ? levels : [{ level: 0, name: "Ground floor" }] };
}

/** Fits an area's name inside it: smaller text and more lines for narrow areas, the code for tiny ones. */
function labelFor(z: Zone, canvasSize: number): { lines: string[]; size: number } {
  const share = shapeSize(z.shape) / canvasSize;
  const lock = z.restricted ? " 🔒" : "";
  if (share < 0.006) return { lines: [z.code + lock], size: 1.8 };
  const [size, width] = share >= 0.04 ? [2.8, 16] : share >= 0.015 ? [2.3, 11] : [1.9, 7];
  const lines: string[] = [];
  for (const word of `${z.name}${lock}`.split(" ")) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= width) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return { lines, size };
}

const onLevel = (level: number | undefined, current: number) =>
  level === undefined || level === current;

/**
 * A venue plan drawn from its layovr-plan areas (rectangles, ring slices,
 * circles, polygons), one floor at a time. An uploaded image, if any, is drawn
 * underneath as a tracing guide. Coordinates are plan canvas units.
 */
export function FloorPlan({
  venue,
  zones,
  spots,
  highlightSpotId,
  dots = [],
  onPlace,
  onSpotClick,
  pin,
  initialLevel,
  caption,
  className,
}: {
  venue: Venue;
  zones: Zone[];
  spots: Spot[];
  highlightSpotId?: string;
  dots?: PlanDot[];
  onPlace?: (x: number, y: number, level: number) => void;
  onSpotClick?: (spot: Spot) => void;
  /** "You are here" marker, e.g. where the buyer tapped. */
  pin?: { x: number; y: number; level?: number };
  initialLevel?: number;
  caption?: ReactNode;
  className?: string;
}) {
  const { canvas, levels } = planFrame(venue, zones);
  const highlighted = spots.find((s) => s.id === highlightSpotId);
  const highlightLevel = zones.find((z) => z.id === highlighted?.zoneId)?.level;
  const [chosen, setLevel] = useState<number | null>(null);
  const level = chosen ?? pin?.level ?? initialLevel ?? highlightLevel ?? levels[0]!.level;

  const zoneLevel = new Map(zones.map((z) => [z.id, z.level]));
  const sectionColor = new Map(
    (venue.plan?.sections ?? []).map((s) => [s.code, s.color ?? "#999999"]),
  );
  const visibleZones = zones
    .filter((z) => onLevel(z.level, level))
    // Big areas first so smaller ones (and their labels) sit on top.
    .sort((a, b) => shapeSize(b.shape) - shapeSize(a.shape));
  const visibleSpots = spots.filter((s) => onLevel(zoneLevel.get(s.zoneId), level));
  const visibleDots = dots.filter((d) => onLevel(d.level, level));
  const markers = (venue.plan?.markers ?? []).filter((m) => onLevel(m.level, level));
  const unit = canvas.width / 100;
  const pct = (x: number, y: number) => ({
    left: `${(x / canvas.width) * 100}%`,
    top: `${(y / canvas.height) * 100}%`,
  });

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onPlace) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * canvas.width * 10) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * canvas.height * 10) / 10;
    onPlace(x, y, level);
  };

  return (
    <figure className={cn("card-pop h-fit self-start overflow-hidden bg-card", className)}>
      {levels.length > 1 && (
        <div
          className="flex gap-1 overflow-x-auto border-b-2 border-ink p-2"
          role="tablist"
          aria-label="Floor"
        >
          {levels.map((l) => {
            const count = dots.filter((d) => d.level === l.level).length;
            return (
              <button
                key={l.level}
                type="button"
                role="tab"
                aria-selected={l.level === level}
                title={l.name}
                onClick={() => setLevel(l.level)}
                className={cn(
                  "shrink-0 rounded-full border-2 border-ink px-3 py-1 text-xs font-bold",
                  l.level === level ? "bg-sun" : "bg-card",
                )}
              >
                {l.level === 0 ? "Ground" : `L${l.level}`}
                {count > 0 && (
                  <span className="ml-1 rounded-full bg-coral px-1.5">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div
        className={cn("relative w-full select-none bg-muted", onPlace && "cursor-crosshair")}
        style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
        onClick={handleClick}
        role={onPlace ? "button" : undefined}
        aria-label={
          onPlace ? "Floor plan: click to place a spot" : `Floor plan of ${venue.name}`
        }
      >
        <svg
          viewBox={`0 0 ${canvas.width} ${canvas.height}`}
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <pattern
              id="hatch"
              width={2 * unit}
              height={2 * unit}
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width={unit} height={2 * unit} fill="rgba(0,0,0,.12)" />
            </pattern>
          </defs>
          {venue.floorPlanUrl && (
            <image
              href={venue.floorPlanUrl}
              width={canvas.width}
              height={canvas.height}
              preserveAspectRatio="none"
              opacity={0.45}
            />
          )}
          {visibleZones.map((z) => {
            const color = (z.section && sectionColor.get(z.section)) || "#F4B942";
            const d = shapePath(z.shape);
            return (
              <g key={z.id}>
                <path
                  d={d}
                  fill={color}
                  fillOpacity={z.kind === "lobby" || z.kind === "outdoor" ? 0.12 : 0.28}
                  stroke="#1d1b2b"
                  strokeWidth={0.35 * unit}
                  strokeDasharray={z.approximate ? `${unit} ${unit}` : undefined}
                />
                {z.restricted && <path d={d} fill="url(#hatch)" />}
              </g>
            );
          })}
          {visibleZones.map((z) => {
            const [cx, cy] = shapeCentre(z.shape);
            const { lines, size } = labelFor(z, canvas.width * canvas.height);
            return (
              <text
                key={`t${z.id}`}
                x={cx}
                y={cy - ((lines.length - 1) * size * unit) / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={size * unit}
                fontWeight={700}
                fill="#1d1b2b"
                stroke="#fbf7ef"
                strokeWidth={0.5 * unit}
                paintOrder="stroke"
                className="pointer-events-none font-display"
              >
                <title>{`${z.name} · ${z.code}`}</title>
                {lines.map((line, i) => (
                  <tspan key={i} x={cx} dy={i === 0 ? 0 : size * unit}>
                    {line}
                  </tspan>
                ))}
              </text>
            );
          })}
          {markers.map((m, i) => (
            <text
              key={`m${i}`}
              x={m.x}
              y={m.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={3.4 * unit}
            >
              <title>{`${m.label}${m.status === "blocked" ? " (blocked)" : ""}${m.note ? ` · ${m.note}` : ""}`}</title>
              {m.status === "blocked" ? "⛔" : MARKER_ICON[m.kind]}
            </text>
          ))}
        </svg>

        {visibleSpots.map((s) => {
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
                "group absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink font-mono font-bold leading-none transition",
                on
                  ? "z-20 bg-coral px-1.5 py-1 text-xs shadow-pop ring-4 ring-coral/30"
                  : "z-10 h-3 w-3 bg-sun hover:z-20",
                !onSpotClick && "pointer-events-none",
              )}
              style={pct(s.x, s.y)}
            >
              {on ? (
                `📍 ${s.code}`
              ) : (
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border-2 border-ink bg-card px-1 py-0.5 text-[10px] group-hover:block">
                  {s.code}
                </span>
              )}
            </button>
          );
        })}

        {pin && onLevel(pin.level, level) && (
          <span
            className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-full text-2xl drop-shadow"
            style={pct(pin.x, pin.y)}
            aria-label="You are here"
          >
            📍
          </span>
        )}

        {visibleDots.filter((d) => d.icon).map((d) => (
          <span
            key={d.id}
            title={d.label}
            className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border-2 border-ink bg-card px-1.5 py-0.5 text-[10px] font-bold shadow-pop"
            style={pct(d.x, d.y)}
          >
            {d.icon} {d.label}
          </span>
        ))}

        {visibleDots.filter((d) => !d.icon).map((d, i) => (
          <span
            key={d.id}
            title={d.label}
            className={cn(
              "absolute z-30 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink",
              d.className,
            )}
            style={{
              left: `calc(${pct(d.x, d.y).left} + ${(i % 3) * 6 - 6}px)`,
              top: `calc(${pct(d.x, d.y).top} - 14px)`,
            }}
          />
        ))}
      </div>
      <figcaption className="border-t-2 border-ink px-4 py-2 text-sm">
        {levels.length > 1 && (
          <span className="mr-2 font-bold">
            {levels.find((l) => l.level === level)?.name}.
          </span>
        )}
        {caption}
      </figcaption>
    </figure>
  );
}
