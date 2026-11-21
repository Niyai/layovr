import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/**
 * The browser's barcode reader where there is one (Chrome on Android), and the
 * ZXing WebAssembly version everywhere else (Safari on iPhone). The fallback is
 * loaded only when someone turns the camera on.
 */
async function makeDetector(formats: string[]): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: DetectorCtor & { getSupportedFormats?: () => Promise<string[]> } })
    .BarcodeDetector;
  if (Native) {
    const supported = (await Native.getSupportedFormats?.().catch(() => [])) ?? [];
    if (formats.every((f) => supported.includes(f))) return new Native({ formats });
  }
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  return new BarcodeDetector({ formats: formats as never[] }) as unknown as Detector;
}

/** Camera preview that reads QR codes and ticket barcodes, then calls onResult once. */
export function CameraScanner({
  onResult,
  formats = ["qr_code"],
  idleText = "We only use the camera to read the code.",
  buttonLabel = "Turn on camera",
  className,
}: {
  onResult: (value: string) => void;
  formats?: string[];
  idleText?: string;
  buttonLabel?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "starting" | "on" | "denied" | "unsupported">("idle");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const done = useRef(onResult);
  done.current = onResult;

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => stop, []);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    setState("starting");
    try {
      const [stream, detector] = await Promise.all([
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }),
        makeDetector(formats),
      ]);
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setState("on");
      const tick = async () => {
        if (!streamRef.current) return;
        const found = await detector.detect(video).catch(() => []);
        const value = found[0]?.rawValue;
        if (value) {
          stop();
          setState("idle");
          done.current(value);
          return;
        }
        window.setTimeout(() => void tick(), 150);
      };
      void tick();
    } catch (e) {
      stop();
      setState(e instanceof DOMException && e.name === "NotAllowedError" ? "denied" : "unsupported");
    }
  };

  return (
    <div className={className}>
      <div className="relative grid aspect-square place-items-center overflow-hidden rounded-2xl border-2 border-ink bg-ink text-ink-foreground">
        {/* Always mounted, so the stream has somewhere to go as soon as it starts. */}
        <video ref={videoRef} className={cn("absolute inset-0 h-full w-full object-cover", state !== "on" && "invisible")} muted playsInline />
        {state !== "on" && (
          <div className="relative p-6 text-center">
            <div className="text-5xl">📷</div>
            <p className="mt-3 text-sm opacity-90">
              {state === "starting" && "Starting the camera…"}
              {state === "unsupported" && "This browser can't use the camera here. Type the code instead."}
              {state === "denied" && "Camera access was blocked. Type the code instead."}
              {state === "idle" && idleText}
            </p>
          </div>
        )}
        {state === "on" && (
          <span className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-sun/80" aria-hidden />
        )}
      </div>
      {state === "on" ? (
        <button
          type="button"
          className="btn mt-4 w-full bg-card"
          onClick={() => {
            stop();
            setState("idle");
          }}
        >
          Stop camera
        </button>
      ) : (
        <button type="button" className="btn mt-4 w-full bg-coral" disabled={state === "starting"} onClick={() => void start()}>
          {buttonLabel}
        </button>
      )}
    </div>
  );
}
