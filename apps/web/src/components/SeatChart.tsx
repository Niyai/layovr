import { rowLabels, seatKey, seatsOf, stagePoint, type PlanMarker, type SeatBlock } from "@layovr/shared";
import type { SeatRef } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * A seating block drawn seat by seat: rows, the stage side, the way in, your
 * seat and your friends' seats. In picking mode, free seats can be tapped.
 */
export function SeatChart({
  blocks,
  you,
  friends = [],
  taken,
  picked,
  onPick,
  portal,
  className,
}: {
  blocks: SeatBlock[];
  you?: SeatRef | undefined;
  friends?: SeatRef[];
  /** Seats that already have a ticket (picking mode greys them out). */
  taken?: Set<string>;
  picked?: SeatRef | undefined;
  onPick?: (seat: SeatRef) => void;
  portal?: PlanMarker | undefined;
  className?: string;
}) {
  if (!blocks.length) return null;
  const seats = blocks.flatMap((b) => seatsOf(b).map((s) => ({ ...s, b })));
  const stages = blocks.map((b) => stagePoint(b.layout));

  // Seat size from the tightest gap between neighbours in a row.
  let gap = Infinity;
  for (const s of seats) {
    const next = seats.find((o) => o.block === s.block && o.rowIndex === s.rowIndex && o.seat === s.seat + 1);
    if (next) gap = Math.min(gap, Math.hypot(next.x - s.x, next.y - s.y));
  }
  if (!Number.isFinite(gap)) gap = 1;
  const r = gap * 0.38;

  // Draw the way in only when it's close to the seats; otherwise it just adds empty space.
  const sx = seats.map((s) => s.x);
  const sy = seats.map((s) => s.y);
  const size = Math.max(Math.max(...sx) - Math.min(...sx), Math.max(...sy) - Math.min(...sy), gap);
  const cx = (Math.max(...sx) + Math.min(...sx)) / 2;
  const cy = (Math.max(...sy) + Math.min(...sy)) / 2;
  const portalNear = portal && Math.hypot(portal.x - cx, portal.y - cy) <= size;
  const xs = [...sx, ...stages.map((p) => p[0]), ...(portalNear ? [portal.x] : [])];
  const ys = [...sy, ...stages.map((p) => p[1]), ...(portalNear ? [portal.y] : [])];
  const pad = gap * 2.5;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad;
  const h = Math.max(...ys) - minY + pad;
  const font = gap * 1.05;

  const is = (ref: SeatRef | undefined, s: { block: string; row: string; seat: number }) =>
    ref !== undefined && ref.block === s.block && ref.row === s.row && ref.seat === s.seat;
  const friendKeys = new Set(friends.map((f) => seatKey(f.block, f.row, f.seat)));

  return (
    <figure className={cn("card-pop overflow-hidden bg-card", className)}>
      <svg
        viewBox={`${minX} ${minY} ${w} ${h}`}
        className="block max-h-[70vh] w-full bg-muted/50"
        role="img"
        aria-label={`Seating chart: ${blocks.map((b) => b.name).join(", ")}`}
      >
        {stages.slice(0, 1).map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={gap * 1.6} fill="#1d1b2b" />
            <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={font * 0.8} fontWeight={800} fill="#fbf7ef">
              STAGE
            </text>
          </g>
        ))}
        {blocks.map((b) => {
          const first = seatsOf(b);
          return rowLabels(b).map((row, ri) => {
            const inRow = first.filter((s) => s.rowIndex === ri);
            const a = inRow[0]!;
            const z = inRow[inRow.length - 1]!;
            // Row letter just beyond each end of the row.
            const dx = (a.x - z.x) / Math.max(Math.hypot(a.x - z.x, a.y - z.y), 0.001);
            const dy = (a.y - z.y) / Math.max(Math.hypot(a.x - z.x, a.y - z.y), 0.001);
            return (
              <g key={`${b.code}${row}`} fill="#1d1b2b" fontSize={font * 0.75} fontWeight={700} textAnchor="middle" dominantBaseline="middle">
                <text x={a.x + dx * gap * 1.1} y={a.y + dy * gap * 1.1}>{row}</text>
                <text x={z.x - dx * gap * 1.1} y={z.y - dy * gap * 1.1}>{row}</text>
              </g>
            );
          });
        })}
        {seats.map((s) => {
          const key = seatKey(s.block, s.row, s.seat);
          const mine = is(you, s);
          const chosen = is(picked, s);
          const friend = friendKeys.has(key);
          const busy = taken?.has(key) && !mine;
          const canPick = onPick && !busy && !mine;
          return (
            <circle
              key={key}
              cx={s.x}
              cy={s.y}
              r={mine || chosen ? r * 1.35 : r}
              fill={mine ? "#E8553B" : chosen ? "#F4B942" : friend ? "#B8A6F0" : busy ? "#c9c4b8" : "#ffffff"}
              stroke="#1d1b2b"
              strokeWidth={mine || chosen ? r * 0.45 : r * 0.25}
              className={cn(canPick && "cursor-pointer hover:fill-[#F4B942]")}
              onClick={canPick ? () => onPick({ block: s.block, row: s.row, seat: s.seat }) : undefined}
            >
              <title>{`${s.b.name} · Row ${s.row} · Seat ${s.seat}${s.accessible ? " · wheelchair space" : ""}${mine ? " (you)" : friend ? " (friend)" : busy ? " (taken)" : ""}`}</title>
            </circle>
          );
        })}
        {portal && portalNear && (
          <text x={portal.x} y={portal.y} textAnchor="middle" dominantBaseline="middle" fontSize={font * 1.6}>
            <title>{portal.label}</title>🚪
          </text>
        )}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 border-t-2 border-ink px-4 py-2 text-xs font-semibold">
        {you && <Legend color="bg-coral" label="Your seat" />}
        {friends.length > 0 && <Legend color="bg-lilac" label="Friends" />}
        {onPick && <Legend color="bg-sun" label="Your pick" />}
        {taken && <Legend color="bg-[#c9c4b8]" label="Taken" />}
        {portal && (
          <span>
            🚪 {portal.label}
            {!portalNear && (stages[0] && Math.hypot(portal.x - stages[0][0], portal.y - stages[0][1]) < Math.hypot(portal.x - cx, portal.y - cy) ? ", behind the stage" : ", behind the back row")}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded-full border-2 border-ink", color)} />
      {label}
    </span>
  );
}
