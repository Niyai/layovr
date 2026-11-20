import type { SeatBlock } from "@layovr/shared";
import { useState } from "react";
import type { SeatRef, SeatRequest } from "@/lib/types";
import { cn } from "@/lib/utils";

const seat = (s: SeatRef) => `${s.block} · Row ${s.row} · Seat ${s.seat}`;

function wants(r: SeatRequest) {
  if (r.want === "seat") return `${r.wantBlock} · Row ${r.wantRow} · Seat ${r.wantSeat}`;
  if (r.want === "block") return `any seat in Block ${r.wantBlock}`;
  return `a seat next to their friends${r.friends?.length ? ` (${r.friends.map(seat).join("; ")})` : ""}`;
}

/**
 * Guests' seat change requests, waiting ones first, for organisers and on-site
 * staff. Approving moves the ticket to the seat in the boxes (prefilled with a
 * free seat that fits); declining sends the note to the guest.
 */
export function SeatRequestList({
  requests,
  blocks,
  onDecide,
}: {
  requests: SeatRequest[];
  blocks: SeatBlock[];
  onDecide: (id: string, decision: "approve" | "decline", to?: SeatRef, note?: string) => Promise<boolean>;
}) {
  if (!requests.length) return <p className="text-sm text-muted-foreground">No seat change requests yet.</p>;
  return (
    <ul className="grid gap-3">
      {requests.map((r) => (
        <SeatRequestItem key={r.id} r={r} blocks={blocks} onDecide={onDecide} />
      ))}
    </ul>
  );
}

function SeatRequestItem({
  r,
  blocks,
  onDecide,
}: {
  r: SeatRequest;
  blocks: SeatBlock[];
  onDecide: (id: string, decision: "approve" | "decline", to?: SeatRef, note?: string) => Promise<boolean>;
}) {
  const start = r.suggestion ?? (r.want === "seat" ? { block: r.wantBlock!, row: r.wantRow!, seat: r.wantSeat! } : undefined);
  const [to, setTo] = useState({ block: start?.block ?? r.wantBlock ?? "", row: start?.row ?? "", seat: start ? String(start.seat) : "" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = r.status === "pending";
  const toTier = blocks.find((b) => b.code === to.block.toUpperCase())?.tier;
  const fromTier = r.tier ?? blocks.find((b) => b.code === r.from.block)?.tier;

  const decide = async (decision: "approve" | "decline") => {
    setBusy(true);
    await onDecide(
      r.id,
      decision,
      decision === "approve" && to.block && to.row && to.seat ? { block: to.block.toUpperCase(), row: to.row.toUpperCase(), seat: Number(to.seat) } : undefined,
      note.trim() || undefined,
    );
    setBusy(false);
  };

  return (
    <li className={cn("rounded-2xl border-2 border-ink p-4", pending ? "bg-card" : "bg-muted/60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">
            {r.guestName || "Guest"} <span className="font-mono text-xs font-normal">{r.ticketNumber}</span>
          </p>
          <p className="text-sm">
            In {seat(r.from)}
            {fromTier ? ` (${fromTier})` : ""}, wants {wants(r)}
          </p>
          {r.note && <p className="mt-1 text-sm italic">“{r.note}”</p>}
        </div>
        <span className={cn("chip", r.status === "approved" ? "bg-mint" : r.status === "pending" ? "bg-sun" : "bg-card")}>{r.status}</span>
      </div>
      {!pending && (
        <p className="mt-2 text-sm">
          {r.to ? `Moved to ${seat(r.to)}.` : ""} {r.decisionNote ? `“${r.decisionNote}”` : ""}
        </p>
      )}
      {pending && (
        <div className="mt-3 grid gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid text-xs font-semibold">
              Block
              <input className="field w-20 font-mono uppercase" value={to.block} onChange={(e) => setTo({ ...to, block: e.target.value })} />
            </label>
            <label className="grid text-xs font-semibold">
              Row
              <input className="field w-16 font-mono uppercase" value={to.row} onChange={(e) => setTo({ ...to, row: e.target.value })} />
            </label>
            <label className="grid text-xs font-semibold">
              Seat
              <input className="field w-20 font-mono" inputMode="numeric" value={to.seat} onChange={(e) => setTo({ ...to, seat: e.target.value.replace(/\D/g, "") })} />
            </label>
            {r.suggestion && <span className="pb-2 text-xs text-muted-foreground">Suggested: a free seat that fits</span>}
            {!r.suggestion && r.want !== "seat" && <span className="pb-2 text-xs text-muted-foreground">No free seat found that fits</span>}
          </div>
          {toTier && fromTier && toTier !== fromTier && (
            <p className="text-sm font-semibold">⚠️ Moves them from {fromTier} to {toTier}. Payment for upgrades isn't handled here.</p>
          )}
          <input className="field" placeholder="Note to the guest (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn bg-mint py-2 text-sm" disabled={busy || !to.block || !to.row || !to.seat} onClick={() => void decide("approve")}>
              Approve and move
            </button>
            <button type="button" className="btn bg-card py-2 text-sm" disabled={busy} onClick={() => void decide("decline")}>
              Decline
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
