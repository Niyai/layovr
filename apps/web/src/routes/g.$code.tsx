import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyCard } from "@/components/ui-bits";
import { groupPreview, joinFriendGroup, useDB, useHydrated, type GroupPreview } from "@/lib/store";

export const Route = createFileRoute("/g/$code")({
  head: () => ({ meta: [{ title: "Join your friends · Layovr" }] }),
  component: JoinGroup,
});

/** A friend group link: join with a ticket already on this phone, or find the ticket first. */
function JoinGroup() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const d = useDB();
  const hydrated = useHydrated();
  const [group, setGroup] = useState<GroupPreview | null | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void groupPreview(code).then(setGroup);
  }, [code]);

  if (group === undefined || !hydrated) return <p className="p-8 text-center">Loading…</p>;
  if (!group) {
    return (
      <div className="px-4 py-12">
        <EmptyCard emoji="🔗" title="That link doesn't work" action={<Link to="/seat" className="btn bg-coral">Find my seat</Link>}>
          <p>Ask your friend to send it again.</p>
        </EmptyCard>
      </div>
    );
  }

  const mine = d.tickets.filter((t) => t.venueId === group.venueId);
  const already = mine.find((t) => t.group?.code === group.code);

  return (
    <div className="mx-auto grid max-w-xl gap-6 px-4 py-10">
      <div className="card-pop bg-lilac p-6">
        <span className="chip bg-card">👋 Friend group</span>
        <h1 className="mt-3 text-3xl font-extrabold">{group.name}</h1>
        <p className="mt-1">
          {group.eventName} · {group.members} {group.members === 1 ? "person" : "people"} so far
        </p>
        <p className="mt-3 text-sm">
          Everyone in the group sees each other's first name and block. Exact seats are shown only for people who allow it.
        </p>
      </div>
      {already ? (
        <Link to="/seat" search={{ ticket: already.id }} className="btn bg-coral">
          You're in. See where everyone is
        </Link>
      ) : mine.length ? (
        mine.map((t) => (
          <button
            key={t.id}
            type="button"
            className="btn bg-coral"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await joinFriendGroup(t.id, group.code);
              setBusy(false);
              if (ok) {
                toast.success("You've joined");
                void navigate({ to: "/seat", search: { ticket: t.id } });
              }
            }}
          >
            Join as {t.firstName} (Block {t.seat.block}, Row {t.seat.row})
          </button>
        ))
      ) : (
        <Link to="/seat" search={{ event: group.eventCode, join: group.code }} className="btn bg-coral">
          Find my ticket to join
        </Link>
      )}
    </div>
  );
}
