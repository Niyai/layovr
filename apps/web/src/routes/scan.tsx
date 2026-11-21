import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CameraScanner } from "@/components/CameraScanner";
import { Field, PageHero, Section } from "@/components/ui-bits";
import { getDB, spotByCode, venueByCode } from "@/lib/store";

export const Route = createFileRoute("/scan")({
  head: () => ({ meta: [{ title: "Scan a code · Layovr" }] }),
  component: Scan,
});

/** Turns a scanned URL or typed code into a route. */
function resolveCode(
  raw: string,
):
  | { to: "/s/$spot"; spot: string }
  | { to: "/l/$code"; code: string }
  | { to: "/e/$event/$spot"; event: string; spot: string }
  | null {
  const text = raw.trim();
  const eventSpot = text.match(/\/e\/([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)/);
  if (eventSpot?.[1] && eventSpot[2]) return { to: "/e/$event/$spot", event: eventSpot[1], spot: eventSpot[2] };
  const fromUrl = text.match(/\/(s|l)\/([A-Za-z0-9-]+)/);
  const d = getDB();
  if (fromUrl?.[1] === "s" && fromUrl[2])
    return { to: "/s/$spot", spot: fromUrl[2] };
  if (fromUrl?.[1] === "l" && fromUrl[2])
    return { to: "/l/$code", code: fromUrl[2] };
  if (spotByCode(d, text)) return { to: "/s/$spot", spot: text.toUpperCase() };
  if (venueByCode(d, text)) return { to: "/l/$code", code: text.toUpperCase() };
  return null;
}

function Scan() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  const go = (raw: string) => {
    // Seat-finder signs at gates and portals open the seat page.
    const seat = raw.match(/\/seat(\?[^\s#]*)?/);
    if (seat) {
      const q = new URLSearchParams(seat[1] ?? "");
      void navigate({
        to: "/seat",
        search: {
          ...(q.get("event") ? { event: q.get("event")! } : {}),
          ...(q.get("from") ? { from: q.get("from")! } : {}),
        },
      });
      return;
    }
    const target = resolveCode(raw);
    if (!target) {
      toast.error(
        "We don't recognise that code. Check the card and try again.",
      );
      return;
    }
    if (target.to === "/e/$event/$spot")
      void navigate({ to: "/e/$event/$spot", params: { event: target.event, spot: target.spot } });
    else if (target.to === "/s/$spot")
      void navigate({ to: "/s/$spot", params: { spot: target.spot } });
    else void navigate({ to: "/l/$code", params: { code: target.code } });
  };

  return (
    <>
      <PageHero
        eyebrow="Scan a code"
        fill="bg-mint"
        title="Point, scan, you're in"
      >
        Your phone's camera app works too: just open it and point it at the
        Layovr code on your seat, table or counter.
      </PageHero>
      <Section className="grid gap-8 md:grid-cols-2">
        <div className="card-pop bg-card p-6">
          <h2 className="text-2xl font-extrabold">Scan here</h2>
          <CameraScanner className="mt-4" onResult={go} />
        </div>
        <form
          className="card-pop bg-sun p-6"
          onSubmit={(e) => {
            e.preventDefault();
            go(code);
          }}
        >
          <h2 className="text-2xl font-extrabold">Or type the code</h2>
          <p className="mt-1">
            It's printed under the QR, like B0-EXH1-1 or MOONSHOT.
          </p>
          <div className="mt-5">
            <Field label="Code">
              <input
                className="field font-mono uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="B0-EXH1-1"
                autoCapitalize="characters"
              />
            </Field>
          </div>
          <button
            type="submit"
            className="btn mt-5 w-full bg-card"
            disabled={!code.trim()}
          >
            Go
          </button>
        </form>
      </Section>
    </>
  );
}
