import { matchColor } from "@layovr/shared";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { MatchSignal } from "@/lib/types";

/** CSS background for a signal: solid, striped, or a slow 1 Hz flash. */
function signalStyle(signal: MatchSignal): CSSProperties {
  const c = matchColor(signal.color);
  if (signal.pattern === "stripes") {
    const other = c.key === "white" ? "#111111" : "#FFFFFF";
    return {
      background: `repeating-linear-gradient(45deg, ${c.hex} 0 48px, ${other} 48px 96px)`,
      color: c.ink,
    };
  }
  return { background: c.hex, color: c.ink };
}

export function signalLabel(signal: MatchSignal): string {
  const c = matchColor(signal.color);
  const extra = signal.pattern === "solid" ? "" : signal.pattern === "stripes" ? " stripes" : " flashing";
  return `${c.name}${extra} ${c.symbol}`;
}

/** Small swatch for cards and lists. */
export function SignalChip({ signal }: { signal: MatchSignal }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border-2 border-ink px-2.5 py-0.5 text-sm font-bold"
      style={signalStyle(signal)}
    >
      {signalLabel(signal)}
    </span>
  );
}

/**
 * Full-screen colour for "raise your phone". Keeps the screen awake while open
 * and buzzes once when it opens, so a phone in a pocket gets noticed.
 */
export function SignalScreen({
  signal,
  title,
  hint,
  onClose,
}: {
  signal: MatchSignal;
  title: string;
  hint: string;
  onClose: () => void;
}) {
  const c = matchColor(signal.color);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    navigator.vibrate?.([200, 100, 200]);
    ref.current?.focus();
    return () => {
      void lock?.release().catch(() => {});
    };
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`${title}: ${signalLabel(signal)}`}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center p-6 text-center outline-none ${
        signal.pattern === "flash" ? "animate-[signal-flash_1s_steps(1)_infinite]" : ""
      }`}
      style={signalStyle(signal)}
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <style>{`@keyframes signal-flash { 50% { background: #FFFFFF; color: #111111; } }`}</style>
      <div className="text-[9rem] leading-none drop-shadow-sm" aria-hidden="true">
        {c.symbol}
      </div>
      <div className="mt-4 font-display text-5xl font-extrabold uppercase tracking-wide">
        {c.name}
        {signal.pattern !== "solid" && (
          <span className="block text-2xl">{signal.pattern === "stripes" ? "stripes" : "flashing"}</span>
        )}
      </div>
      <p className="mt-6 max-w-xs rounded-2xl bg-black/25 px-4 py-3 text-lg font-bold text-white">
        {title}
        <span className="mt-1 block text-sm font-semibold">{hint}</span>
      </p>
      <p className="mt-8 text-sm font-bold opacity-80">Tap anywhere to close</p>
    </div>
  );
}

/** Opens the signal screen the first time a signal appears (e.g. when the runner arrives). */
export function useSignalPrompt(signal: MatchSignal | undefined) {
  const [open, setOpen] = useState(false);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const key = signal ? `${signal.color}:${signal.pattern}` : null;
    if (key && seen.current !== key) setOpen(true);
    seen.current = key;
  }, [signal?.color, signal?.pattern]);
  return [open, setOpen] as const;
}
