import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Field, PageHero, Section } from "@/components/ui-bits";
import { getDB, spotByCode, venueByCode } from "@/lib/store";

export const Route = createFileRoute("/scan")({
  head: () => ({ meta: [{ title: "Scan a code · Layovr" }] }),
  component: Scan,
});

type Detector = {
  detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/** Turns a scanned URL or typed code into a route. */
function resolveCode(
  raw: string,
): { to: "/s/$spot"; spot: string } | { to: "/l/$code"; code: string } | null {
  const text = raw.trim();
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
  const [camera, setCamera] = useState<
    "idle" | "on" | "unsupported" | "denied"
  >("idle");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const go = (raw: string) => {
    const target = resolveCode(raw);
    if (!target) {
      toast.error(
        "We don't recognise that code. Check the card and try again.",
      );
      return;
    }
    if (target.to === "/s/$spot")
      void navigate({ to: "/s/$spot", params: { spot: target.spot } });
    else void navigate({ to: "/l/$code", params: { code: target.code } });
  };

  useEffect(
    () => () => streamRef.current?.getTracks().forEach((t) => t.stop()),
    [],
  );

  const startCamera = async () => {
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor })
      .BarcodeDetector;
    if (!Ctor) {
      setCamera("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setCamera("on");
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const detector = new Ctor({ formats: ["qr_code"] });
      const tick = async () => {
        if (!streamRef.current) return;
        const found = await detector.detect(video).catch(() => []);
        const value = found[0]?.rawValue;
        if (value) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          go(value);
          return;
        }
        requestAnimationFrame(() => void tick());
      };
      void tick();
    } catch {
      setCamera("denied");
    }
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
          <div className="mt-4 grid aspect-square place-items-center overflow-hidden rounded-2xl border-2 border-ink bg-ink text-ink-foreground">
            {camera === "on" ? (
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                muted
                playsInline
              />
            ) : (
              <div className="p-6 text-center">
                <div className="text-5xl">📷</div>
                <p className="mt-3 text-sm opacity-90">
                  {camera === "unsupported" &&
                    "This browser can't scan here. Use your camera app, or type the code."}
                  {camera === "denied" &&
                    "Camera access was blocked. Type the code instead."}
                  {camera === "idle" &&
                    "We only use the camera to read the code."}
                </p>
              </div>
            )}
          </div>
          {camera !== "on" && (
            <button
              type="button"
              className="btn mt-5 w-full bg-coral"
              onClick={() => void startCamera()}
            >
              Turn on camera
            </button>
          )}
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
            It's printed under the QR, like MB-C or MOONSHOT.
          </p>
          <div className="mt-5">
            <Field label="Code">
              <input
                className="field font-mono uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="MB-C"
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
