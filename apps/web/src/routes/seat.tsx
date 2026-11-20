import { nearestSpot, seatDirections, seatKey, seatsOf, type SeatBlock } from "@layovr/shared";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { CameraScanner } from "@/components/CameraScanner";
import { FloorPlan } from "@/components/FloorPlan";
import { SeatChart } from "@/components/SeatChart";
import { Field } from "@/components/ui-bits";
import {
  cancelSeatRequest,
  createFriendGroup,
  deliverToSeat,
  findTicket,
  forgetTicket,
  joinFriendGroup,
  leaveFriendGroup,
  requestSeatChange,
  setShareSeat,
  takenSeats,
  useDB,
  useHydrated,
} from "@/lib/store";
import type { GuestTicket, SeatRef, SeatRequest, SeatRequestWant, Snapshot, Venue } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/seat")({
  validateSearch: (s) =>
    z
      .object({
        event: z.string().optional(),
        /** Where the guest is: a marker label from a sign's QR code. */
        from: z.string().optional(),
        /** A friend group to join once the ticket is found. */
        join: z.string().optional(),
        ticket: z.string().optional(),
      })
      .parse(s),
  head: () => ({ meta: [{ title: "Find my seat · Layovr" }] }),
  component: SeatPage,
});

const seatText = (s: SeatRef) => `Block ${s.block} · Row ${s.row} · Seat ${s.seat}`;

function SeatPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const d = useDB();
  const hydrated = useHydrated();
  const event = search.event?.toUpperCase();
  const eventVenue = event ? d.venues.find((v) => v.code === event) : undefined;
  const tickets = d.tickets.filter((t) => !eventVenue || t.venueId === eventVenue.id);
  const [adding, setAdding] = useState(false);
  const ticket = tickets.find((t) => t.id === search.ticket) ?? tickets[0];

  const select = (id: string) =>
    void navigate({ to: "/seat", search: { ...search, ticket: id, join: undefined }, replace: true });

  if (!hydrated) return <p className="p-8 text-center">Loading…</p>;

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      {ticket && !adding ? (
        <>
          {tickets.length > 1 && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Your tickets">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={t.id === ticket.id}
                  onClick={() => select(t.id)}
                  className={cn("rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold", t.id === ticket.id ? "bg-sun" : "bg-card")}
                >
                  {t.firstName} · {t.seat.block} {t.seat.row}
                  {t.seat.seat}
                </button>
              ))}
            </div>
          )}
          <SeatGuide key={ticket.id} d={d} ticket={ticket} from={search.from} />
          <div className="flex flex-wrap justify-between gap-3 text-sm">
            <button type="button" className="font-bold underline" onClick={() => setAdding(true)}>
              + Add another ticket
            </button>
            <button
              type="button"
              className="text-muted-foreground underline"
              onClick={() => {
                forgetTicket(ticket.id);
                toast.success("Removed from this phone");
              }}
            >
              Remove this ticket from this phone
            </button>
          </div>
        </>
      ) : (
        <FindTicket
          event={event}
          eventName={eventVenue?.name}
          join={search.join}
          onFound={(id) => {
            setAdding(false);
            select(id);
          }}
          onCancel={ticket ? () => setAdding(false) : undefined}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ find */

function FindTicket({
  event,
  eventName,
  join,
  onFound,
  onCancel,
}: {
  event?: string | undefined;
  eventName?: string | undefined;
  join?: string | undefined;
  onFound: (ticketId: string) => void;
  onCancel?: (() => void) | undefined;
}) {
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);

  const lookup = async (value: string) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    const id = await findTicket(value, event);
    if (id && join) {
      if (await joinFriendGroup(id, join)) toast.success("You've joined your friends' group");
    }
    setBusy(false);
    if (id) onFound(id);
  };

  return (
    <>
      <div>
        <span className="chip bg-sun">🎟️ Find my seat</span>
        <h1 className="mt-3 text-3xl font-extrabold">Where am I sitting?</h1>
        <p className="mt-1 text-muted-foreground">
          {eventName ? `${eventName}: s` : "S"}can the barcode on your ticket or type the ticket number. We'll walk you to your seat.
        </p>
        {join && <p className="mt-2 font-semibold">Then we'll add you to your friends' group.</p>}
      </div>
      <form
        className="card-pop grid gap-4 bg-sun p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(number);
        }}
      >
        <Field label="Ticket number" hint="Printed on your ticket or in your ticket email">
          <input
            className="field font-mono uppercase"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="e.g. MOON-0001"
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
          />
        </Field>
        <button type="submit" className="btn bg-coral" disabled={!number.trim() || busy}>
          {busy ? "Looking…" : "Find my seat"}
        </button>
      </form>
      <div className="card-pop bg-card p-6">
        <h2 className="text-xl font-extrabold">Or scan your ticket</h2>
        <CameraScanner
          className="mt-4"
          formats={["qr_code", "pdf417", "aztec", "code_128", "data_matrix"]}
          idleText="Hold your ticket's barcode or QR code up to the camera. We only use the camera to read it."
          buttonLabel="📷 Scan my ticket"
          onResult={(value) => void lookup(value)}
        />
      </div>
      {onCancel && (
        <button type="button" className="text-sm font-bold underline" onClick={onCancel}>
          Back to my seat
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ guide */

function SeatGuide({ d, ticket, from: fromParam }: { d: Snapshot; ticket: GuestTicket; from?: string | undefined }) {
  const navigate = useNavigate();
  const venue = d.venues.find((v) => v.id === ticket.venueId);
  const blocks = venue?.plan?.seating ?? [];
  const block = blocks.find((b) => b.code === ticket.seat.block);
  const markers = venue?.plan?.markers ?? [];
  const startOptions = markers.filter((m) => m.kind === "entrance" || m.kind === "portal");
  const [from, setFrom] = useState(fromParam ?? ticket.gate ?? "");
  const [showMap, setShowMap] = useState(false);

  if (!venue || !block) {
    return (
      <div className="card-pop bg-sun p-6">
        <span className="chip bg-card">Your seat</span>
        <p className="mt-3 text-3xl font-extrabold">{seatText(ticket.seat)}</p>
        <p className="mt-2">This event's seating chart isn't on Layovr yet, so ask an usher to show you the way.</p>
      </div>
    );
  }

  const zones = d.zones.filter((z) => z.venueId === venue.id);
  const area = zones.find((z) => z.code === block.area);
  const plan = { levels: venue.plan?.levels ?? [], markers };
  const guide = seatDirections(plan, area?.name ?? "the hall", area?.level, block, ticket.seat.row, ticket.seat.seat, from || undefined);
  const portal = markers.find((m) => m.label === block.portal);
  const levelName = guide?.level === undefined ? undefined : plan.levels.find((l) => l.level === guide.level)?.name;
  const friends = (ticket.group?.members ?? []).filter((m) => !m.isMe && m.row && m.seat !== undefined);
  const friendSeats = friends.map((f) => ({ block: f.block, row: f.row!, seat: f.seat! }));

  const orderToSeat = () => {
    if (!guide) return;
    const spots = d.spots.filter((s) => s.venueId === venue.id);
    const spot = nearestSpot(spots, zones, guide.pos.x, guide.pos.y, guide.level);
    if (!spot) {
      toast.error("Ordering to seats isn't set up at this event yet.");
      return;
    }
    deliverToSeat(spot.id, { method: "seat", x: guide.pos.x, y: guide.pos.y, ...(guide.level === undefined ? {} : { level: guide.level }) }, guide.title);
    void navigate({ to: "/l/$code", params: { code: venue.code } });
  };

  return (
    <>
      <section className="card-pop bg-sun p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="chip bg-card">Hi {ticket.firstName} · your seat</span>
          {ticket.checkedInAt ? (
            <span className="chip bg-mint">✓ Checked in{ticket.gate ? ` · ${ticket.gate}` : ""}</span>
          ) : (
            <span className="chip bg-card">Not checked in yet</span>
          )}
        </div>
        <p className="mt-4 text-sm font-bold uppercase tracking-wider">{block.name}</p>
        <p className="mt-1 flex flex-wrap gap-x-6 gap-y-1 font-display text-4xl font-extrabold leading-tight">
          <span>Row {ticket.seat.row}</span>
          <span>Seat {ticket.seat.seat}</span>
        </p>
        <p className="mt-2 text-sm">
          {[area?.name, levelName, ticket.tier, venue.name].filter(Boolean).join(" · ")}
        </p>
      </section>

      <section className="card-pop bg-card p-6">
        <h2 className="text-xl font-extrabold">How to get there</h2>
        <label className="mt-3 block text-sm font-semibold">
          I'm at
          <select className="field mt-1" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Outside, or not sure</option>
            {startOptions.map((m) => (
              <option key={m.label} value={m.label} disabled={m.status === "blocked"}>
                {m.label}
                {m.status === "blocked" ? " (closed)" : ""}
              </option>
            ))}
          </select>
        </label>
        {guide && (
          <ol className="mt-4 grid gap-3">
            {guide.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-sun text-sm font-extrabold">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Lost? Scan any Layovr sign near you (📷 Scan in the menu) and the steps start from there, or ask an usher.
        </p>
      </section>

      <SeatChart blocks={[block]} you={ticket.seat} friends={friendSeats.filter((f) => f.block === block.code)} portal={portal} />

      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" className="btn bg-card" onClick={() => setShowMap((v) => !v)} aria-expanded={showMap}>
          🗺️ {showMap ? "Hide the venue map" : "Show on the venue map"}
        </button>
        <button type="button" className="btn bg-coral" onClick={orderToSeat}>
          🛍️ Order food to my seat
        </button>
      </div>
      {showMap && guide && (
        <FloorPlan
          venue={venue}
          zones={zones}
          spots={[]}
          pin={{ x: guide.pos.x, y: guide.pos.y, ...(guide.level === undefined ? {} : { level: guide.level }) }}
          {...(guide.level === undefined ? {} : { initialLevel: guide.level })}
          caption={`📍 ${guide.title}`}
        />
      )}

      <Friends ticket={ticket} />
      <SeatChange ticket={ticket} venue={venue} blocks={blocks} />
    </>
  );
}

/* ------------------------------------------------------------------ friends */

function Friends({ ticket }: { ticket: GuestTicket }) {
  const [busy, setBusy] = useState(false);
  const group = ticket.group;
  const link = group && typeof window !== "undefined" ? `${window.location.origin}/g/${group.code}` : "";

  if (!group) {
    return (
      <section className="card-pop bg-lilac p-6">
        <h2 className="text-xl font-extrabold">👋 See your friends here</h2>
        <p className="mt-2 text-sm">
          Start a group and send the link to your friends. When they open it with their ticket, you'll see where each other is sitting.
        </p>
        <button
          type="button"
          className="btn mt-4 bg-card"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await createFriendGroup(ticket.id);
            setBusy(false);
          }}
        >
          Start a friend group
        </button>
        <p className="mt-3 text-xs">
          No contacts needed. Only people with your link can join; they see your first name and block, and your exact seat only if you allow it.
        </p>
      </section>
    );
  }

  return (
    <section className="card-pop bg-lilac p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-extrabold">👋 {group.name}</h2>
        <span className="text-sm font-semibold">{group.members.length} here</span>
      </div>
      <ul className="mt-3 divide-y-2 divide-ink/10 rounded-2xl border-2 border-ink bg-card">
        {group.members.map((m, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="font-bold">
              {m.firstName}
              {m.isMe && <span className="font-normal text-muted-foreground"> (you)</span>}
            </span>
            <span className="text-right text-sm">
              {m.row && m.seat !== undefined ? `${m.block} · Row ${m.row} · Seat ${m.seat}` : `Block ${m.block} · seat hidden`}
              <span className="block text-xs text-muted-foreground">{m.checkedIn ? "✓ checked in" : "not here yet"}</span>
            </span>
          </li>
        ))}
      </ul>
      <label className="mt-4 flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={ticket.shareSeat} onChange={(e) => void setShareSeat(ticket.id, e.target.checked)} />
        Show my exact seat to this group
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          className="btn bg-mint"
          href={`https://wa.me/?text=${encodeURIComponent(`Join me at the event on Layovr, so we can see where we're all sitting: ${link}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Invite on WhatsApp
        </a>
        <button
          type="button"
          className="btn bg-card"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(
              () => toast.success("Link copied"),
              () => toast.error("Couldn't copy. Long-press the link instead."),
            );
          }}
        >
          Copy link
        </button>
      </div>
      <p className="mt-2 break-all font-mono text-xs">{link}</p>
      <button type="button" className="mt-4 text-sm underline" onClick={() => void leaveFriendGroup(ticket.id)}>
        Leave this group
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ seat changes */

const WANT_LABEL: Record<SeatRequestWant, string> = {
  seat: "A specific seat",
  block: "Any seat in a block",
  friends: "Next to my friends",
};

function requestText(r: SeatRequest) {
  if (r.want === "seat") return `Asked for ${r.wantBlock} · Row ${r.wantRow} · Seat ${r.wantSeat}`;
  if (r.want === "block") return `Asked for any seat in Block ${r.wantBlock}`;
  return "Asked to sit with friends";
}

function SeatChange({ ticket, venue, blocks }: { ticket: GuestTicket; venue: Venue; blocks: SeatBlock[] }) {
  const mode = venue.seatChanges ?? "review";
  const pending = ticket.requests.find((r) => r.status === "pending");
  const recent = ticket.requests.filter((r) => r.status !== "pending").slice(0, 3);
  const [open, setOpen] = useState(false);
  const [want, setWant] = useState<SeatRequestWant>("seat");
  const [blockCode, setBlockCode] = useState(ticket.seat.block);
  const [picked, setPicked] = useState<SeatRef>();
  const [note, setNote] = useState("");
  const [taken, setTaken] = useState<Set<string>>();
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    void takenSeats(ticket.id).then(setTaken);
  }, [open, ticket.id]);

  const block = blocks.find((b) => b.code === blockCode);
  const freeInBlock = block && taken ? seatsOf(block).filter((s) => !taken.has(seatKey(block.code, s.row, s.seat))).length : undefined;

  const submit = async () => {
    setBusy(true);
    const ok = await requestSeatChange(ticket.id, {
      want,
      ...(want !== "friends" ? { block: blockCode } : {}),
      ...(want === "seat" && picked ? { row: picked.row, seat: picked.seat } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (ok) {
      setOpen(false);
      setPicked(undefined);
      setNote("");
      loaded.current = false;
      toast.success(mode === "auto" ? "Sent. Free seats at your ticket type are confirmed straight away." : "Sent to the organisers");
    }
  };

  return (
    <section className="card-pop bg-card p-6">
      <h2 className="text-xl font-extrabold">Need a different seat?</h2>
      {recent.map((r) => (
        <p key={r.id} className={cn("mt-3 rounded-xl border-2 border-ink px-3 py-2 text-sm", r.status === "approved" ? "bg-mint" : "bg-muted")}>
          {r.status === "approved" && r.to ? <b>Moved to {seatText(r.to)}.</b> : <b>{requestText(r)}: {r.status}.</b>}
          {r.decisionNote && <span> “{r.decisionNote}”</span>}
        </p>
      ))}
      {mode === "off" ? (
        <p className="mt-2 text-sm">Seat changes aren't taken through Layovr at this event. Please ask an usher.</p>
      ) : pending ? (
        <div className="mt-3 rounded-xl border-2 border-ink bg-sun/50 px-3 py-3 text-sm">
          <b>Waiting for the organisers.</b> {requestText(pending)}
          {pending.note && <span className="block text-muted-foreground">“{pending.note}”</span>}
          <button type="button" className="mt-2 block font-bold underline" onClick={() => void cancelSeatRequest(ticket.id, pending.id)}>
            Cancel request
          </button>
        </div>
      ) : !open ? (
        <>
          <p className="mt-2 text-sm">
            Ask to move: a seat you pick, any seat in another block, or next to your friends.
            {mode === "auto" ? " Free seats at your ticket type are confirmed straight away." : " The organisers will confirm."}
          </p>
          <button type="button" className="btn mt-4 bg-sun" onClick={() => setOpen(true)}>
            Ask to change seats
          </button>
        </>
      ) : (
        <div className="mt-4 grid gap-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What would you like?">
            {(["seat", "block", "friends"] as const)
              .filter((w) => w !== "friends" || ticket.group)
              .map((w) => (
                <button
                  key={w}
                  type="button"
                  role="radio"
                  aria-checked={want === w}
                  onClick={() => setWant(w)}
                  className={cn("rounded-full border-2 border-ink px-3 py-1.5 text-sm font-bold", want === w ? "bg-sun" : "bg-card")}
                >
                  {WANT_LABEL[w]}
                </button>
              ))}
          </div>
          {want !== "friends" && (
            <label className="text-sm font-semibold">
              Block
              <select
                className="field mt-1"
                value={blockCode}
                onChange={(e) => {
                  setBlockCode(e.target.value);
                  setPicked(undefined);
                }}
              >
                {blocks.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                    {b.tier ? ` · ${b.tier}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {block?.tier && ticket.tier && block.tier !== ticket.tier && want !== "friends" && (
            <p className="text-sm font-semibold">Your ticket is {ticket.tier}; {block.name} is {block.tier}. The organisers decide on moves between ticket types.</p>
          )}
          {want === "seat" && block && (
            <>
              <p className="text-sm">
                Tap a free seat. {picked ? <b>Picked: Row {picked.row}, Seat {picked.seat}.</b> : freeInBlock !== undefined ? `${freeInBlock} free in ${block.name}.` : "Loading free seats…"}
              </p>
              <SeatChart
                blocks={[block]}
                you={block.code === ticket.seat.block ? ticket.seat : undefined}
                taken={taken ?? new Set()}
                picked={picked}
                onPick={setPicked}
              />
            </>
          )}
          {want === "friends" && <p className="text-sm">The organisers will look for a free seat next to {ticket.group?.name}.</p>}
          <Field label="Anything they should know? (optional)">
            <input className="field" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I need an aisle seat" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn bg-coral" disabled={busy || (want === "seat" && !picked)} onClick={() => void submit()}>
              {busy ? "Sending…" : "Send request"}
            </button>
            <button type="button" className="btn bg-card" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        <Link to="/l/$code" params={{ code: venue.code }} className="underline">
          {venue.name}
        </Link>
      </p>
    </section>
  );
}
