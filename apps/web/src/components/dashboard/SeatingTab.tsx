import {
  TICKET_CSV_EXAMPLE,
  seatBlockSchema,
  seatCount,
  seatsOf,
  shapePath,
  shapePoints,
  stagePoint,
  type SeatBlock,
  type SeatBlockInput,
  type VenuePlan,
} from "@layovr/shared";
import { useState } from "react";
import { toast } from "sonner";
import { QrImage } from "@/components/QrImage";
import { SeatChart } from "@/components/SeatChart";
import { SeatRequestList } from "@/components/SeatRequests";
import { Field } from "@/components/ui-bits";
import {
  papi,
  refresh,
  usePlan,
  useSeatRequests,
  useTickets,
  type EventDetail,
  type PlanSaveResult,
  type TicketImportResult,
} from "@/lib/partnerApi";
import type { SeatRef } from "@/lib/types";
import { cn } from "@/lib/utils";

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

/**
 * Seated events: seat blocks on the plan, tickets from the organiser's
 * ticketing system, guests' seat change requests, and seat-finder signs.
 */
export function SeatingTab({ event }: { event: EventDetail }) {
  const plan = usePlan(event.id);
  if (plan.isError) return <p>Add a venue plan first (Venue plan tab).</p>;
  if (!plan.data) return <p>Loading…</p>;
  return (
    <div className="grid gap-6">
      <SeatChanges event={event} />
      <Blocks event={event} plan={plan.data} />
      <Tickets event={event} hasBlocks={plan.data.seating.length > 0} />
      <Requests event={event} blocks={plan.data.seating} />
      <Signs event={event} plan={plan.data} />
    </div>
  );
}

/* ------------------------------------------------------------------ setting */

function SeatChanges({ event }: { event: EventDetail }) {
  const set = async (seatChanges: EventDetail["seatChanges"]) => {
    try {
      await papi(`/partner/events/${event.id}`, { method: "PATCH", body: { seatChanges } });
      await refresh(["events", event.id]);
    } catch (e) {
      err(e);
    }
  };
  const options = [
    ["off", "Off", "Guests are told to ask an usher."],
    ["review", "You decide", "Requests wait here (and on the on-site admin screen) for someone to approve."],
    ["auto", "Automatic", "A free seat with the same ticket type is confirmed at once; anything else waits for you."],
  ] as const;
  return (
    <section className="card-pop bg-card p-5">
      <h3 className="font-display text-lg font-bold">Seat change requests from guests</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup">
        {options.map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={event.seatChanges === value}
            onClick={() => void set(value)}
            className={cn("rounded-2xl border-2 border-ink p-3 text-left", event.seatChanges === value ? "bg-sun shadow-pop" : "bg-card")}
          >
            <b>{label}</b>
            <span className="block text-xs">{hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ blocks */

type Draft = {
  code: string;
  name: string;
  area: string;
  level: string;
  type: "rows" | "arc";
  x: string;
  y: string;
  w: string;
  h: string;
  front: "top" | "bottom" | "left" | "right";
  cx: string;
  cy: string;
  r0: string;
  r1: string;
  a0: string;
  a1: string;
  rows: string;
  seatsPerRow: string;
  firstSeat: string;
  numbering: "ltr" | "rtl";
  aisleAfter: string;
  portal: string;
  tier: string;
  accessible: string;
};

const num = (s: string) => Number(s.trim());
const list = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
const r1 = (n: number) => String(Math.round(n * 10) / 10);

function toDraft(b: SeatBlock): Draft {
  const l = b.layout;
  return {
    code: b.code,
    name: b.name,
    area: b.area,
    level: b.level === undefined ? "" : String(b.level),
    type: l.type,
    x: l.type === "rows" ? String(l.x) : "",
    y: l.type === "rows" ? String(l.y) : "",
    w: l.type === "rows" ? String(l.w) : "",
    h: l.type === "rows" ? String(l.h) : "",
    front: l.type === "rows" ? l.front : "top",
    cx: l.type === "arc" ? String(l.cx) : "",
    cy: l.type === "arc" ? String(l.cy) : "",
    r0: l.type === "arc" ? String(l.r0) : "",
    r1: l.type === "arc" ? String(l.r1) : "",
    a0: l.type === "arc" ? String(l.a0) : "",
    a1: l.type === "arc" ? String(l.a1) : "",
    rows: typeof b.rows === "number" ? String(b.rows) : b.rows.join(", "),
    seatsPerRow: typeof b.seatsPerRow === "number" ? String(b.seatsPerRow) : b.seatsPerRow.join(", "),
    firstSeat: String(b.firstSeat),
    numbering: b.numbering,
    aisleAfter: b.aisleAfter.join(", "),
    portal: b.portal ?? "",
    tier: b.tier ?? "",
    accessible: b.accessible.join(", "),
  };
}

/** A starting block filling the middle of an area: 10 rows of 12, stage at the top. */
function newDraft(plan: VenuePlan, areaCode: string, code: string): Draft {
  const area = plan.areas.find((a) => a.code === areaCode);
  const pts = area ? shapePoints(area.shape) : [[10, 10] as [number, number], [30, 30] as [number, number]];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const empty = toDraft({
    code,
    name: `Block ${code}`,
    area: areaCode,
    layout: { type: "rows", x: x0 + (x1 - x0) * 0.2, y: y0 + (y1 - y0) * 0.25, w: (x1 - x0) * 0.6, h: (y1 - y0) * 0.5, front: "top" },
    rows: 10,
    seatsPerRow: 12,
    firstSeat: 1,
    numbering: "ltr",
    aisleAfter: [],
    accessible: [],
  });
  return { ...empty, x: r1(num(empty.x)), y: r1(num(empty.y)), w: r1(num(empty.w)), h: r1(num(empty.h)) };
}

function fromDraft(d: Draft): { block?: SeatBlock; error?: string } {
  const rows = /^\d+$/.test(d.rows.trim()) ? num(d.rows) : list(d.rows);
  const seats = /^\d+$/.test(d.seatsPerRow.trim()) ? num(d.seatsPerRow) : list(d.seatsPerRow).map(Number);
  const input: SeatBlockInput = {
    code: d.code,
    name: d.name.trim() || `Block ${d.code}`,
    area: d.area,
    ...(d.level.trim() ? { level: num(d.level) } : {}),
    layout:
      d.type === "rows"
        ? { type: "rows", x: num(d.x), y: num(d.y), w: num(d.w), h: num(d.h), front: d.front }
        : { type: "arc", cx: num(d.cx), cy: num(d.cy), r0: num(d.r0), r1: num(d.r1), a0: num(d.a0), a1: num(d.a1) },
    rows,
    seatsPerRow: seats,
    firstSeat: num(d.firstSeat || "1"),
    numbering: d.numbering,
    aisleAfter: list(d.aisleAfter).map(Number),
    ...(d.portal ? { portal: d.portal } : {}),
    ...(d.tier.trim() ? { tier: d.tier.trim() } : {}),
    accessible: list(d.accessible),
  };
  const parsed = seatBlockSchema.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { error: `${i?.path.join(".")}: ${i?.message}` };
  }
  return { block: parsed.data };
}

function Blocks({ event, plan }: { event: EventDetail; plan: VenuePlan }) {
  const [editing, setEditing] = useState<{ index: number; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const blocks = plan.seating;
  const preview = editing ? fromDraft(editing.draft) : null;
  const shown = editing ? blocks.map((b, i) => (i === editing.index ? preview?.block : b)).filter(Boolean) as SeatBlock[] : blocks;
  if (editing && editing.index === blocks.length && preview?.block) shown.push(preview.block);
  const portals = plan.markers.filter((m) => m.kind === "portal" || m.kind === "entrance");

  const save = async (seating: SeatBlock[]) => {
    setBusy(true);
    try {
      const r = await papi<PlanSaveResult>(`/partner/events/${event.id}/plan`, { method: "PUT", body: { ...plan, seating } });
      if (!r.applied) {
        toast.error(r.errors[0] ?? "That didn't save");
        return false;
      }
      const seatWarnings = r.warnings.filter((w) => w.startsWith("Seat block"));
      if (seatWarnings.length) toast.warning(seatWarnings[0]);
      else toast.success("Seating saved");
      await refresh(["events", event.id]);
      return true;
    } catch (e) {
      err(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<Draft>) => editing && setEditing({ ...editing, draft: { ...editing.draft, ...patch } });
  const d = editing?.draft;
  const numField = (key: keyof Draft, label: string) => (
    <label className="grid text-xs font-semibold">
      {label}
      <input className="field font-mono" inputMode="decimal" value={d![key]} onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)} />
    </label>
  );

  return (
    <section className="card-pop grid gap-4 bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold">Seat blocks</h3>
        <span className="text-sm text-muted-foreground">
          {blocks.length} blocks · {blocks.reduce((n, b) => n + seatCount(b), 0).toLocaleString()} seats
        </span>
      </div>
      <p className="text-sm">
        Describe each block the way the venue's seating chart does: rows from the front, seats across, and the door guests use. Block codes must match the
        section or block on your tickets.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <SeatingOverview plan={plan} blocks={shown} highlight={editing ? preview?.block?.code : undefined} />
        <div className="grid h-fit gap-2">
          {blocks.map((b, i) => (
            <div key={b.code} className={cn("flex items-center justify-between gap-2 rounded-xl border-2 border-ink px-3 py-2", editing?.index === i ? "bg-sun" : "bg-card")}>
              <span className="text-sm">
                <b>{b.name}</b> <span className="font-mono text-xs">{b.code}</span>
                <span className="block text-xs text-muted-foreground">
                  {seatCount(b)} seats · in {b.area}
                  {b.tier ? ` · ${b.tier}` : ""}
                  {b.portal ? ` · 🚪 ${b.portal}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 gap-2 text-sm">
                <button type="button" className="font-bold underline" onClick={() => setEditing({ index: i, draft: toDraft(b) })}>
                  Edit
                </button>
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    if (window.confirm(`Remove ${b.name}? Tickets for it will no longer match a seat.`)) void save(blocks.filter((_, j) => j !== i));
                  }}
                >
                  Remove
                </button>
              </span>
            </div>
          ))}
          {!editing && (
            <button
              type="button"
              className="btn bg-sun"
              disabled={!plan.areas.length}
              onClick={() => {
                const area = plan.areas.find((a) => a.kind === "hall" || a.kind === "seating") ?? plan.areas[0]!;
                let n = blocks.length + 1;
                while (blocks.some((b) => b.code === String.fromCharCode(64 + n))) n++;
                setEditing({ index: blocks.length, draft: newDraft(plan, area.code, String.fromCharCode(64 + Math.min(n, 26))) });
              }}
            >
              + Add a seat block
            </button>
          )}
        </div>
      </div>

      {editing && d && (
        <form
          className="grid gap-4 rounded-2xl border-2 border-ink bg-muted/40 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!preview?.block) return;
            const next = [...blocks];
            next[editing.index] = preview.block;
            if (await save(next)) setEditing(null);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Code (as on tickets)">
              <input className="field font-mono uppercase" value={d.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Name">
              <input className="field" value={d.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="In area">
              <select className="field" value={d.area} onChange={(e) => set({ area: e.target.value })}>
                {plan.areas.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Shape">
            {(
              [
                ["rows", "Straight rows"],
                ["arc", "Curved rows round a stage"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={d.type === t}
                onClick={() => {
                  if (t === "arc" && !d.cx) {
                    const [sx, sy] = [num(d.x) + num(d.w) / 2, num(d.y)];
                    set({ type: t, cx: r1(sx), cy: r1(sy), r0: r1(num(d.h) * 0.2), r1: r1(num(d.h)), a0: "150", a1: "210" });
                  } else set({ type: t });
                }}
                className={cn("rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold", d.type === t ? "bg-sun" : "bg-card")}
              >
                {label}
              </button>
            ))}
          </div>
          {d.type === "rows" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {numField("x", "Left (x)")}
              {numField("y", "Top (y)")}
              {numField("w", "Width")}
              {numField("h", "Depth")}
              <label className="grid text-xs font-semibold">
                Stage side
                <select className="field" value={d.front} onChange={(e) => set({ front: e.target.value as Draft["front"] })}>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {numField("cx", "Stage x")}
              {numField("cy", "Stage y")}
              {numField("r0", "Front row distance")}
              {numField("r1", "Back row distance")}
              {numField("a0", "From angle")}
              {numField("a1", "To angle")}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Rows" hint="A number (A, B, C…), or labels front first">
              <input className="field font-mono uppercase" value={d.rows} onChange={(e) => set({ rows: e.target.value })} />
            </Field>
            <Field label="Seats per row" hint="One number, or one per row">
              <input className="field font-mono" value={d.seatsPerRow} onChange={(e) => set({ seatsPerRow: e.target.value })} />
            </Field>
            <Field label="First seat number">
              <input className="field font-mono" inputMode="numeric" value={d.firstSeat} onChange={(e) => set({ firstSeat: e.target.value })} />
            </Field>
            <Field label="Numbers run" hint="As seen facing the stage">
              <select className="field" value={d.numbering} onChange={(e) => set({ numbering: e.target.value as Draft["numbering"] })}>
                <option value="ltr">Left to right</option>
                <option value="rtl">Right to left</option>
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Way in" hint="Add portals in the Venue plan tab">
              <select className="field" value={d.portal} onChange={(e) => set({ portal: e.target.value })}>
                <option value="">Not set</option>
                {portals.map((m) => (
                  <option key={m.label} value={m.label}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Floor">
              <select className="field" value={d.level} onChange={(e) => set({ level: e.target.value })}>
                <option value="">Same as the area</option>
                {plan.levels.map((l) => (
                  <option key={l.level} value={l.level}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ticket type">
              <input className="field" value={d.tier} placeholder="e.g. VIP" onChange={(e) => set({ tier: e.target.value })} />
            </Field>
            <Field label="Aisle after seats">
              <input className="field font-mono" value={d.aisleAfter} placeholder="e.g. 8, 16" onChange={(e) => set({ aisleAfter: e.target.value })} />
            </Field>
          </div>
          <Field label="Wheelchair spaces (row-seat)">
            <input className="field font-mono uppercase" value={d.accessible} placeholder="e.g. A-1, A-2" onChange={(e) => set({ accessible: e.target.value })} />
          </Field>
          {preview?.error ? (
            <p className="text-sm font-semibold text-destructive">{preview.error}</p>
          ) : (
            preview?.block && (
              <>
                <p className="text-sm">{seatCount(preview.block)} seats. Check the row letters and the stage side below.</p>
                <SeatChart blocks={[preview.block]} portal={plan.markers.find((m) => m.label === preview.block!.portal)} />
              </>
            )
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn bg-coral" disabled={busy || !preview?.block}>
              {busy ? "Saving…" : "Save block"}
            </button>
            <button type="button" className="btn bg-card" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** The whole plan with every seat drawn, to check blocks sit in the right place. */
function SeatingOverview({ plan, blocks, highlight }: { plan: VenuePlan; blocks: SeatBlock[]; highlight?: string | undefined }) {
  const { width, height } = plan.canvas;
  const dot = Math.max(width, height) / 300;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-2xl border-2 border-ink bg-muted" role="img" aria-label="Seat blocks on the venue plan">
      {plan.areas.map((a) => (
        <path key={a.code} d={shapePath(a.shape)} fill="#F4B942" fillOpacity={0.18} stroke="#1d1b2b" strokeWidth={dot * 0.6} />
      ))}
      {blocks.map((b) => {
        const [sx, sy] = stagePoint(b.layout);
        const on = b.code === highlight;
        return (
          <g key={b.code}>
            {seatsOf(b).map((s) => (
              <circle key={`${s.row}${s.seat}`} cx={s.x} cy={s.y} r={dot} fill={on ? "#E8553B" : "#1d1b2b"} />
            ))}
            <circle cx={sx} cy={sy} r={dot * 2.5} fill="#B8A6F0" stroke="#1d1b2b" strokeWidth={dot * 0.5} />
          </g>
        );
      })}
      {plan.markers
        .filter((m) => m.kind === "portal")
        .map((m) => (
          <text key={m.label} x={m.x} y={m.y} fontSize={dot * 6} textAnchor="middle" dominantBaseline="middle">
            🚪
          </text>
        ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ tickets */

function Tickets({ event, hasBlocks }: { event: EventDetail; hasBlocks: boolean }) {
  const [q, setQ] = useState("");
  const tickets = useTickets(event.id, q);
  const [csv, setCsv] = useState("");
  const [replace, setReplace] = useState(false);
  const [check, setCheck] = useState<TicketImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const t = tickets.data;

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await papi<TicketImportResult>(`/partner/events/${event.id}/tickets/import${dryRun ? "?dryRun=1" : ""}`, {
        body: { csv, replace },
      });
      setCheck(r);
      if (r.applied) {
        toast.success(`Imported ${r.total} tickets`);
        setCsv("");
        setCheck(null);
        await refresh(["events", event.id]);
      }
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-pop grid gap-4 bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold">Tickets</h3>
        {t && (
          <span className="text-sm text-muted-foreground">
            {t.total.toLocaleString()} tickets for {t.seats.toLocaleString()} seats · {t.checkedIn.toLocaleString()} checked in
          </span>
        )}
      </div>
      <p className="text-sm">
        Import the export from your ticketing system (CSV). Each ticket needs a number and its block, row and seat; barcode, name, ticket type, check-in and gate
        are optional. Importing again updates seats.{" "}
        <a className="font-bold underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TICKET_CSV_EXAMPLE)}`} download="tickets-example.csv">
          Example file
        </a>
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="grid gap-2">
          <input
            type="file"
            accept=".csv,text/csv"
            className="text-sm"
            disabled={!hasBlocks}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setCsv(await f.text());
              setCheck(null);
            }}
          />
          <textarea
            className="field min-h-28 font-mono text-xs"
            placeholder={hasBlocks ? "…or paste the CSV here" : "Add seat blocks first"}
            disabled={!hasBlocks}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setCheck(null);
            }}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Remove tickets that aren't in this file
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn bg-card py-2 text-sm" disabled={busy || !csv.trim()} onClick={() => void run(true)}>
              Check file
            </button>
            {check?.ok && (
              <button type="button" className="btn bg-coral py-2 text-sm" disabled={busy} onClick={() => void run(false)}>
                Import {check.total} tickets
              </button>
            )}
            <button
              type="button"
              className="btn bg-lilac py-2 text-sm"
              disabled={busy || !hasBlocks}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await papi<TicketImportResult>(`/partner/events/${event.id}/tickets/test`, { body: { share: 0.6 } });
                  toast.success(`Added ${r.added} test tickets`);
                  await refresh(["events", event.id]);
                } catch (e) {
                  err(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Fill with test tickets
            </button>
          </div>
          {check && (
            <div className={cn("rounded-xl border-2 border-ink p-3 text-sm", check.ok ? "bg-mint/60" : "bg-blush")}>
              {check.ok ? (
                <b>
                  Ready: {check.added} new, {check.updated} updated{check.removed ? `, ${check.removed} removed` : ""}.
                </b>
              ) : (
                <b>Fix these first:</b>
              )}
              <ul className="mt-1 list-disc pl-5">
                {[...check.errors, ...check.warnings].slice(0, 12).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Gate scanners or your ticketing system can report check-ins as they happen (POST /api/partner/events/{event.id}/tickets/checkin, see{" "}
            <a className="underline" href="/developers">
              Developers
            </a>
            ). Guests' directions then start from the gate they came in by.
          </p>
        </div>
        <div className="grid h-fit gap-2">
          <input className="field" placeholder="Search by ticket number, name or seat" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-96 overflow-y-auto rounded-xl border-2 border-ink">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-muted text-xs">
                <tr>
                  <th className="px-2 py-1.5">Ticket</th>
                  <th className="px-2 py-1.5">Name</th>
                  <th className="px-2 py-1.5">Seat</th>
                  <th className="px-2 py-1.5">In</th>
                </tr>
              </thead>
              <tbody>
                {t?.tickets.map((x) => (
                  <tr key={x.id} className="border-t border-ink/10">
                    <td className="px-2 py-1.5 font-mono text-xs">{x.number}</td>
                    <td className="px-2 py-1.5">
                      {x.name}
                      {x.inGroup && " 👋"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {x.seat.block} {x.seat.row}
                      {x.seat.seat}
                    </td>
                    <td className="px-2 py-1.5" title={x.gate ?? undefined}>
                      {x.checkedInAt ? "✓" : ""}
                    </td>
                  </tr>
                ))}
                {t && !t.tickets.length && (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">
                      {q ? "No matches" : "No tickets yet"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ requests */

function Requests({ event, blocks }: { event: EventDetail; blocks: SeatBlock[] }) {
  const requests = useSeatRequests(event.id);
  const waiting = requests.data?.filter((r) => r.status === "pending").length ?? 0;
  return (
    <section className="card-pop grid gap-3 bg-card p-5">
      <h3 className="font-display text-lg font-bold">
        Seat change requests {waiting > 0 && <span className="chip ml-1 bg-coral">{waiting} waiting</span>}
      </h3>
      {requests.data && (
        <SeatRequestList
          requests={requests.data}
          blocks={blocks}
          onDecide={async (id, decision, to?: SeatRef, note?: string) => {
            try {
              await papi(`/partner/events/${event.id}/seat-requests/${id}`, { body: { decision, ...(to ?? {}), ...(note ? { note } : {}) } });
              toast.success(decision === "approve" ? "Moved. The guest sees their new seat." : "Declined");
              await refresh(["events", event.id]);
              return true;
            } catch (e) {
              err(e);
              return false;
            }
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ signs */

function Signs({ event, plan }: { event: EventDetail; plan: VenuePlan }) {
  const signs = [
    { label: "Find your seat", sub: "For screens and posters at every gate", url: event.seatUrl },
    ...plan.markers
      .filter((m) => (m.kind === "entrance" || m.kind === "portal") && m.status !== "blocked")
      .map((m) => ({ label: m.label, sub: "Directions start here", url: `${event.seatUrl}&from=${encodeURIComponent(m.label)}` })),
  ];
  return (
    <section className="card-pop grid gap-3 bg-card p-5">
      <h3 className="font-display text-lg font-bold">Seat-finder signs</h3>
      <p className="text-sm">
        Put the first one on screens and posters at the gates. Stick the others at each entrance and portal: a guest who scans one gets directions from where
        they're standing.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {signs.map((s) => (
          <figure key={s.url} className="grid justify-items-center gap-1 rounded-xl border-2 border-ink p-3 text-center">
            <QrImage value={s.url} size={110} />
            <figcaption className="text-xs">
              <b className="block">{s.label}</b>
              {s.sub}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
