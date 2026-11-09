import {
  AREA_KINDS,
  MARKER_KINDS,
  areaAt,
  checkPlan,
  shapeCentre,
  shapePath,
  shapeSize,
  type AreaKind,
  type Shape,
  type VenuePlan,
} from "@layovr/shared";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { Field } from "@/components/ui-bits";
import type { PlanSaveResult } from "@/lib/partnerApi";
import { cn } from "@/lib/utils";

/**
 * Visual editor for a layovr-plan/1 file. Everything happens on an in-memory
 * copy; checkPlan (the same rules the server uses) runs live, and Save sends
 * the whole file back, removing areas and spots you deleted.
 */

type Area = VenuePlan["areas"][number];
type Spot = VenuePlan["spots"][number];
type Marker = VenuePlan["markers"][number];
type Tool = "select" | "rect" | "polygon" | "spot" | "marker";
type Selection = { type: "area"; code: string } | { type: "spot"; code: string } | { type: "marker"; index: number } | null;

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

const snap = (n: number) => Math.round(n * 2) / 2;
const onLevel = (l: number | undefined, current: number) => l === undefined || l === current;

function moveShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.type) {
    case "rect":
      return { ...s, x: snap(s.x + dx), y: snap(s.y + dy) };
    case "circle":
    case "sector":
      return { ...s, cx: snap(s.cx + dx), cy: snap(s.cy + dy) };
    case "polygon":
      return { ...s, points: s.points.map(([x, y]) => [snap(x + dx), snap(y + dy)] as [number, number]) };
  }
}

function uniqueCode(base: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const code = `${base}${n}`;
    if (!taken.has(code)) return code;
  }
}

/** Next spot code in the standard <section><level>-<area>-<n> format. */
function spotCode(area: Area, spots: Spot[]): string {
  const prefix = `${area.section ?? ""}${area.level ?? ""}`;
  const stem = `${prefix ? `${prefix}-` : ""}${area.code}-`;
  let n = 1;
  while (spots.some((s) => s.code === `${stem}${n}`)) n++;
  return `${stem}${n}`;
}

export function PlanEditor({
  initial,
  tracingUrl,
  onSave,
}: {
  initial: VenuePlan;
  tracingUrl?: string | null;
  onSave: (plan: VenuePlan) => Promise<PlanSaveResult>;
}) {
  const [doc, setDoc] = useState<VenuePlan>(initial);
  const [past, setPast] = useState<VenuePlan[]>([]);
  const [future, setFuture] = useState<VenuePlan[]>([]);
  const [saved, setSaved] = useState<VenuePlan>(initial);
  const [tool, setTool] = useState<Tool>("select");
  const [sel, setSel] = useState<Selection>(null);
  const [level, setLevel] = useState(() => Math.min(...initial.levels.map((l) => l.level)));
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [poly, setPoly] = useState<[number, number][]>([]);
  const [drag, setDrag] = useState<{ x: number; y: number; base: VenuePlan; resize?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const { width: W, height: H } = doc.canvas;
  const u = W / 100;
  const check = useMemo(() => checkPlan(doc), [doc]);
  const dirty = JSON.stringify(doc) !== JSON.stringify(saved);

  /** Apply a change and record it for undo. */
  const commit = (next: VenuePlan, base: VenuePlan = doc) => {
    setPast((p) => [...p.slice(-49), base]);
    setFuture([]);
    setDoc(next);
  };
  const undo = () => {
    const prev = past.at(-1);
    if (!prev) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [doc, ...f]);
    setDoc(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, doc]);
    setDoc(next);
  };

  const toCanvas = (e: { clientX: number; clientY: number }): [number, number] => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [Math.max(0, Math.min(W, p.x)), Math.max(0, Math.min(H, p.y))];
  };

  const areaCodes = new Set(doc.areas.map((a) => a.code));
  const newArea = (shape: Shape): Area => {
    const code = uniqueCode("AREA", areaCodes);
    return {
      code,
      name: `New area ${code.slice(4)}`,
      ...(doc.sections[0] ? { section: doc.sections[0].code } : {}),
      level,
      kind: "hall",
      access: "open",
      shape,
      approximate: false,
    };
  };

  const removeSelected = () => {
    if (!sel) return;
    if (sel.type === "area") {
      const inside = doc.spots.filter((s) => s.area === sel.code).length;
      if (inside && !window.confirm(`Delete area ${sel.code} and its ${inside} spot${inside === 1 ? "" : "s"}?`)) return;
      commit({ ...doc, areas: doc.areas.filter((a) => a.code !== sel.code), spots: doc.spots.filter((s) => s.area !== sel.code) });
    } else if (sel.type === "spot") {
      commit({ ...doc, spots: doc.spots.filter((s) => s.code !== sel.code) });
    } else {
      commit({ ...doc, markers: doc.markers.filter((_, i) => i !== sel.index) });
    }
    setSel(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select");
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        removeSelected();
      } else if (e.key === "Enter" && tool === "polygon") {
        finishPolygon();
      } else if (e.key === "Escape") {
        setPoly([]);
        setDraft(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const finishPolygon = () => {
    if (poly.length < 3) {
      toast("A shape needs at least 3 corners.");
      return;
    }
    const a = newArea({ type: "polygon", points: poly });
    commit({ ...doc, areas: [...doc.areas, a] });
    setPoly([]);
    setTool("select");
    setSel({ type: "area", code: a.code });
  };

  /* ---------------------------------------------------------- pointer handling */

  const onCanvasDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const [x, y] = toCanvas(e);
    if (tool === "rect") {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDraft({ x0: x, y0: y, x1: x, y1: y });
    } else if (tool === "polygon") {
      setPoly((p) => [...p, [snap(x), snap(y)]]);
    } else if (tool === "spot") {
      const area = areaAt(doc.areas, x, y, level);
      if (!area) {
        toast("Click inside an area to place a spot.");
        return;
      }
      const s: Spot = { code: spotCode(area, doc.spots), area: area.code, label: `${area.name} · spot`, x: snap(x), y: snap(y), active: true };
      commit({ ...doc, spots: [...doc.spots, s] });
      setSel({ type: "spot", code: s.code });
      setTool("select");
    } else if (tool === "marker") {
      const n = doc.markers.filter((m) => m.kind === "entrance").length + 1;
      const m: Marker = { kind: "entrance", label: `Entrance ${n}`, level, x: snap(x), y: snap(y), status: "open" };
      commit({ ...doc, markers: [...doc.markers, m] });
      setSel({ type: "marker", index: doc.markers.length });
      setTool("select");
    } else {
      setSel(null);
    }
  };

  const startDrag = (e: ReactPointerEvent, next: Selection, resize = false) => {
    if (tool !== "select") return;
    e.stopPropagation();
    setSel(next);
    const [x, y] = toCanvas(e);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ x, y, base: doc, resize });
  };

  const onMove = (e: ReactPointerEvent) => {
    if (draft) {
      const [x, y] = toCanvas(e);
      setDraft({ ...draft, x1: x, y1: y });
      return;
    }
    if (!drag || !sel) return;
    const [x, y] = toCanvas(e);
    const dx = x - drag.x;
    const dy = y - drag.y;
    const b = drag.base;
    if (sel.type === "area") {
      setDoc({
        ...b,
        areas: b.areas.map((a) => {
          if (a.code !== sel.code) return a;
          if (drag.resize && a.shape.type === "rect") {
            return { ...a, shape: { ...a.shape, w: Math.max(1, snap(a.shape.w + dx)), h: Math.max(1, snap(a.shape.h + dy)) } };
          }
          return { ...a, shape: moveShape(a.shape, dx, dy) };
        }),
        // Spots move with their area.
        spots: drag.resize ? b.spots : b.spots.map((s) => (s.area === sel.code ? { ...s, x: snap(s.x + dx), y: snap(s.y + dy) } : s)),
      });
    } else if (sel.type === "spot") {
      setDoc({ ...b, spots: b.spots.map((s) => (s.code === sel.code ? { ...s, x: snap(s.x + dx), y: snap(s.y + dy) } : s)) });
    } else {
      setDoc({ ...b, markers: b.markers.map((m, i) => (i === sel.index ? { ...m, x: snap(m.x + dx), y: snap(m.y + dy) } : m)) });
    }
  };

  const onUp = () => {
    if (draft) {
      const x = Math.min(draft.x0, draft.x1);
      const y = Math.min(draft.y0, draft.y1);
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);
      setDraft(null);
      if (w > 1 && h > 1) {
        const a = newArea({ type: "rect", x: snap(x), y: snap(y), w: snap(w), h: snap(h) });
        commit({ ...doc, areas: [...doc.areas, a] });
        setSel({ type: "area", code: a.code });
        setTool("select");
      }
      return;
    }
    if (drag) {
      if (JSON.stringify(drag.base) !== JSON.stringify(doc)) {
        setPast((p) => [...p.slice(-49), drag.base]);
        setFuture([]);
      }
      setDrag(null);
    }
  };

  /* ---------------------------------------------------------- editing helpers */

  const updateArea = (code: string, patch: Partial<Area>) => {
    const nextCode = patch.code;
    commit({
      ...doc,
      areas: doc.areas.map((a) => (a.code === code ? { ...a, ...patch } : a)),
      spots: nextCode && nextCode !== code ? doc.spots.map((s) => (s.area === code ? { ...s, area: nextCode } : s)) : doc.spots,
    });
    if (nextCode && nextCode !== code) setSel({ type: "area", code: nextCode });
  };
  const updateSpot = (code: string, patch: Partial<Spot>) => {
    commit({ ...doc, spots: doc.spots.map((s) => (s.code === code ? { ...s, ...patch } : s)) });
    if (patch.code && patch.code !== code) setSel({ type: "spot", code: patch.code });
  };
  const updateMarker = (index: number, patch: Partial<Marker>) =>
    commit({ ...doc, markers: doc.markers.map((m, i) => (i === index ? { ...m, ...patch } : m)) });

  const save = async () => {
    setSaving(true);
    try {
      const r = await onSave(doc);
      if (r.applied) {
        setSaved(doc);
        const removed = (r.removedAreas ?? 0) + (r.removedSpots ?? 0);
        toast.success(
          `Plan saved${removed ? ` · removed ${r.removedAreas ?? 0} area(s), ${r.removedSpots ?? 0} spot(s)` : ""}${r.deactivatedSpots ? ` · ${r.deactivatedSpots} spot(s) with orders switched off` : ""}`,
        );
      } else {
        toast.error(r.errors[0] ?? "The plan couldn't be saved");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const selectedArea = sel?.type === "area" ? doc.areas.find((a) => a.code === sel.code) : undefined;
  const selectedSpot = sel?.type === "spot" ? doc.spots.find((s) => s.code === sel.code) : undefined;
  const selectedMarker = sel?.type === "marker" ? doc.markers[sel.index] : undefined;
  const colors = new Map(doc.sections.map((s) => [s.code, s.color ?? "#999999"]));
  const areaLevel = new Map(doc.areas.map((a) => [a.code, a.level]));
  const visibleAreas = doc.areas.filter((a) => onLevel(a.level, level)).sort((a, b) => shapeSize(b.shape) - shapeSize(a.shape));

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
      <div className="grid h-fit gap-3">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border-2 border-ink bg-card p-2" role="toolbar" aria-label="Plan tools">
          {(
            [
              ["select", "↖ Select / move"],
              ["rect", "▭ Draw area"],
              ["polygon", "⬠ Draw shape"],
              ["spot", "📍 Add spot"],
              ["marker", "🚪 Add marker"],
            ] as const
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              aria-pressed={tool === t}
              onClick={() => {
                setTool(t);
                setPoly([]);
              }}
              className={cn("rounded-full border-2 border-ink px-3 py-1 text-sm font-bold", tool === t ? "bg-sun" : "bg-card")}
            >
              {label}
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-ink/20" />
          <button type="button" className="btn btn-sm bg-card" disabled={!past.length} onClick={undo} title="Undo (Ctrl/⌘+Z)">
            ↶ Undo
          </button>
          <button type="button" className="btn btn-sm bg-card" disabled={!future.length} onClick={redo} title="Redo (Ctrl/⌘+Shift+Z)">
            ↷ Redo
          </button>
          <button type="button" className="btn btn-sm bg-blush" disabled={!sel} onClick={removeSelected}>
            🗑 Delete
          </button>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {tool === "rect" && "Drag on the plan to draw a rectangle."}
          {tool === "polygon" && `Click each corner, then press Enter or double-click to finish (${poly.length} corners). Esc cancels.`}
          {tool === "spot" && "Click inside an area to add a QR spot."}
          {tool === "marker" && "Click to add an entrance. Change its type (stairs, lift, ops desk…) in the panel."}
          {tool === "select" && "Click to select, drag to move. Drag the small square to resize a rectangle."}
        </p>

        {/* floors */}
        {doc.levels.length > 1 && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Floor">
            {[...doc.levels].sort((a, b) => a.level - b.level).map((l) => (
              <button
                key={l.level}
                type="button"
                role="tab"
                aria-selected={l.level === level}
                onClick={() => setLevel(l.level)}
                className={cn("rounded-full border-2 border-ink px-3 py-1 text-xs font-bold", l.level === level ? "bg-sun" : "bg-card")}
              >
                {l.name}
              </button>
            ))}
          </div>
        )}

        <div className="card-pop overflow-hidden bg-card">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className={cn("block w-full touch-none select-none bg-muted", tool !== "select" && "cursor-crosshair")}
            style={{ aspectRatio: `${W} / ${H}` }}
            onPointerDown={onCanvasDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onDoubleClick={() => tool === "polygon" && finishPolygon()}
            role="application"
            aria-label="Plan editor canvas"
          >
            <defs>
              <pattern id="ed-hatch" width={2 * u} height={2 * u} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width={u} height={2 * u} fill="rgba(0,0,0,.12)" />
              </pattern>
            </defs>
            {tracingUrl && <image href={tracingUrl} width={W} height={H} preserveAspectRatio="none" opacity={0.4} />}
            {visibleAreas.map((a) => {
              const on = sel?.type === "area" && sel.code === a.code;
              const d = shapePath(a.shape);
              const [cx, cy] = shapeCentre(a.shape);
              return (
                <g key={a.code} onPointerDown={(e) => startDrag(e, { type: "area", code: a.code })} className={tool === "select" ? "cursor-move" : ""}>
                  <path
                    d={d}
                    fill={(a.section && colors.get(a.section)) || "#F4B942"}
                    fillOpacity={on ? 0.5 : 0.28}
                    stroke={on ? "#E8553B" : "#1d1b2b"}
                    strokeWidth={(on ? 0.8 : 0.35) * u}
                    strokeDasharray={a.approximate ? `${u} ${u}` : undefined}
                  />
                  {a.access === "restricted" && <path d={d} fill="url(#ed-hatch)" pointerEvents="none" />}
                  <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize={2.2 * u} fontWeight={700} fill="#1d1b2b" pointerEvents="none">
                    {a.name.length > 22 ? `${a.name.slice(0, 20)}…` : a.name}
                  </text>
                  {on && a.shape.type === "rect" && (
                    <rect
                      x={a.shape.x + a.shape.w - u}
                      y={a.shape.y + a.shape.h - u}
                      width={2 * u}
                      height={2 * u}
                      fill="#E8553B"
                      stroke="#1d1b2b"
                      strokeWidth={0.3 * u}
                      className="cursor-nwse-resize"
                      onPointerDown={(e) => startDrag(e, { type: "area", code: a.code }, true)}
                    />
                  )}
                </g>
              );
            })}
            {doc.spots
              .filter((s) => onLevel(areaLevel.get(s.area), level))
              .map((s) => {
                const on = sel?.type === "spot" && sel.code === s.code;
                return (
                  <g key={s.code} onPointerDown={(e) => startDrag(e, { type: "spot", code: s.code })} className={tool === "select" ? "cursor-move" : ""}>
                    <circle cx={s.x} cy={s.y} r={(on ? 1.6 : 1.1) * u} fill={s.active ? "#FFD400" : "#cccccc"} stroke="#1d1b2b" strokeWidth={0.35 * u} />
                    {on && (
                      <text x={s.x} y={s.y - 2.2 * u} textAnchor="middle" fontSize={1.8 * u} fontWeight={700} fill="#1d1b2b" pointerEvents="none">
                        {s.code}
                      </text>
                    )}
                  </g>
                );
              })}
            {doc.markers.map((m, i) =>
              onLevel(m.level, level) ? (
                <text
                  key={i}
                  x={m.x}
                  y={m.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={(sel?.type === "marker" && sel.index === i ? 4.4 : 3.4) * u}
                  onPointerDown={(e) => startDrag(e, { type: "marker", index: i })}
                  className={tool === "select" ? "cursor-move" : ""}
                >
                  <title>{m.label}</title>
                  {m.status === "blocked" ? "⛔" : MARKER_ICON[m.kind]}
                </text>
              ) : null,
            )}
            {draft && (
              <rect
                x={Math.min(draft.x0, draft.x1)}
                y={Math.min(draft.y0, draft.y1)}
                width={Math.abs(draft.x1 - draft.x0)}
                height={Math.abs(draft.y1 - draft.y0)}
                fill="#E8553B"
                fillOpacity={0.2}
                stroke="#E8553B"
                strokeWidth={0.5 * u}
                strokeDasharray={`${u} ${u}`}
                pointerEvents="none"
              />
            )}
            {poly.length > 0 && (
              <polyline points={poly.map((p) => p.join(",")).join(" ")} fill="none" stroke="#E8553B" strokeWidth={0.5 * u} pointerEvents="none" />
            )}
          </svg>
        </div>
        <p className="text-xs text-muted-foreground">
          Canvas {W} × {H} {doc.canvas.unit === "m" ? "m" : doc.canvas.unit}. Dashed = approximate. Hatched = restricted. ⛔ = blocked.
        </p>
      </div>

      {/* side panel */}
      <aside className="grid h-fit gap-4">
        <section className="card-pop grid gap-2 bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg font-bold">{dirty ? "Unsaved changes" : "All changes saved"}</h3>
            <button type="button" className="btn btn-sm bg-coral" disabled={!dirty || !check.ok || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save plan"}
            </button>
          </div>
          {check.errors.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-destructive">
              {check.errors.slice(0, 6).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {check.warnings.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-bold">{check.warnings.length} thing{check.warnings.length === 1 ? "" : "s"} to check</summary>
              <ul className="mt-1 list-disc pl-5">
                {check.warnings.slice(0, 12).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {selectedArea && (
          <section className="card-pop grid gap-3 bg-sun p-4">
            <h3 className="font-display text-lg font-bold">Area</h3>
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <Field label="Code">
                <input
                  className="field py-1.5 font-mono uppercase"
                  defaultValue={selectedArea.code}
                  key={`c${selectedArea.code}`}
                  onBlur={(e) => {
                    const code = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
                    if (!code || code === selectedArea.code) return;
                    if (areaCodes.has(code)) {
                      toast.error(`Area ${code} already exists`);
                      return;
                    }
                    updateArea(selectedArea.code, { code });
                  }}
                />
              </Field>
              <Field label="Name">
                <input
                  className="field py-1.5"
                  defaultValue={selectedArea.name}
                  key={`n${selectedArea.code}`}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== selectedArea.name && updateArea(selectedArea.code, { name: e.target.value.trim() })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Kind">
                <select className="field py-1.5" value={selectedArea.kind} onChange={(e) => updateArea(selectedArea.code, { kind: e.target.value as AreaKind })}>
                  {Object.entries(AREA_KINDS).map(([k, d]) => (
                    <option key={k} value={k} title={d}>
                      {k}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Floor">
                <select
                  className="field py-1.5"
                  value={selectedArea.level === undefined ? "all" : String(selectedArea.level)}
                  onChange={(e) => {
                    const { level: _l, ...rest } = selectedArea;
                    const next: Area = e.target.value === "all" ? rest : { ...rest, level: Number(e.target.value) };
                    commit({ ...doc, areas: doc.areas.map((a) => (a.code === selectedArea.code ? next : a)) });
                  }}
                >
                  <option value="all">Every floor</option>
                  {doc.levels.map((l) => (
                    <option key={l.level} value={l.level}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Section">
                <select
                  className="field py-1.5"
                  value={selectedArea.section ?? ""}
                  onChange={(e) => {
                    const { section: _s, ...rest } = selectedArea;
                    const next: Area = e.target.value ? { ...rest, section: e.target.value } : rest;
                    commit({ ...doc, areas: doc.areas.map((a) => (a.code === selectedArea.code ? next : a)) });
                  }}
                >
                  <option value="">None</option>
                  {doc.sections.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Capacity">
                <input
                  className="field py-1.5"
                  type="number"
                  min={0}
                  defaultValue={selectedArea.capacity ?? ""}
                  key={`cap${selectedArea.code}`}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    const { capacity: _c, ...rest } = selectedArea;
                    commit({ ...doc, areas: doc.areas.map((a) => (a.code === selectedArea.code ? (n > 0 ? { ...rest, capacity: Math.round(n) } : rest) : a)) });
                  }}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={selectedArea.access === "restricted"}
                onChange={(e) => updateArea(selectedArea.code, { access: e.target.checked ? "restricted" : "open" })}
              />
              Restricted (VIP, backstage): only runners with access
            </label>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" className="h-5 w-5" checked={selectedArea.approximate} onChange={(e) => updateArea(selectedArea.code, { approximate: e.target.checked })} />
              Approximate: check on the site walk
            </label>
            <ShapeNumbers shape={selectedArea.shape} onChange={(shape) => updateArea(selectedArea.code, { shape })} />
            <button
              type="button"
              className="btn btn-sm bg-card"
              onClick={() => {
                const [x, y] = shapeCentre(selectedArea.shape);
                const s: Spot = { code: spotCode(selectedArea, doc.spots), area: selectedArea.code, label: `${selectedArea.name} · spot`, x: snap(x), y: snap(y), active: true };
                commit({ ...doc, spots: [...doc.spots, s] });
                setSel({ type: "spot", code: s.code });
              }}
            >
              + Add a spot in this area
            </button>
          </section>
        )}

        {selectedSpot && (
          <section className="card-pop grid gap-3 bg-sun p-4">
            <h3 className="font-display text-lg font-bold">QR spot</h3>
            <Field label="Code" hint="Printed under the QR">
              <input
                className="field py-1.5 font-mono uppercase"
                defaultValue={selectedSpot.code}
                key={`sc${selectedSpot.code}`}
                onBlur={(e) => {
                  const code = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
                  if (!code || code === selectedSpot.code) return;
                  if (doc.spots.some((s) => s.code === code)) {
                    toast.error(`Spot ${code} already exists`);
                    return;
                  }
                  updateSpot(selectedSpot.code, { code });
                }}
              />
            </Field>
            <Field label="Label buyers and runners see">
              <input className="field py-1.5" defaultValue={selectedSpot.label} key={`sl${selectedSpot.code}`} onBlur={(e) => e.target.value.trim() && updateSpot(selectedSpot.code, { label: e.target.value.trim() })} />
            </Field>
            <Field label="Directions from the ops desk" hint="Optional">
              <input
                className="field py-1.5"
                defaultValue={selectedSpot.directions ?? ""}
                key={`sd${selectedSpot.code}`}
                onBlur={(e) => {
                  const { directions: _d, ...rest } = selectedSpot;
                  const v = e.target.value.trim();
                  commit({ ...doc, spots: doc.spots.map((s) => (s.code === selectedSpot.code ? (v ? { ...rest, directions: v } : rest) : s)) });
                }}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input type="checkbox" className="h-5 w-5" checked={selectedSpot.active} onChange={(e) => updateSpot(selectedSpot.code, { active: e.target.checked })} />
              Active (switch off a card without deleting it)
            </label>
          </section>
        )}

        {selectedMarker && sel?.type === "marker" && (
          <section className="card-pop grid gap-3 bg-sun p-4">
            <h3 className="font-display text-lg font-bold">Marker</h3>
            <Field label="Type">
              <select className="field py-1.5" value={selectedMarker.kind} onChange={(e) => updateMarker(sel.index, { kind: e.target.value as Marker["kind"] })}>
                {Object.entries(MARKER_KINDS).map(([k, d]) => (
                  <option key={k} value={k}>
                    {MARKER_ICON[k as keyof typeof MARKER_KINDS]} {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Label">
              <input className="field py-1.5" defaultValue={selectedMarker.label} key={`ml${sel.index}`} onBlur={(e) => e.target.value.trim() && updateMarker(sel.index, { label: e.target.value.trim() })} />
            </Field>
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={selectedMarker.status === "blocked"}
                onChange={(e) => updateMarker(sel.index, { status: e.target.checked ? "blocked" : "open" })}
              />
              ⛔ Blocked (closed today)
            </label>
            {selectedMarker.status === "blocked" && (
              <Field label="Why it's blocked" hint="Runners see this">
                <input className="field py-1.5" defaultValue={selectedMarker.note ?? ""} key={`mn${sel.index}`} onBlur={(e) => updateMarker(sel.index, { note: e.target.value.trim() })} />
              </Field>
            )}
          </section>
        )}

        <RoundAreaForm canvas={doc.canvas} onAdd={(shape) => {
          const a = newArea(shape);
          commit({ ...doc, areas: [...doc.areas, a] });
          setSel({ type: "area", code: a.code });
        }} />

        <section className="card-pop grid gap-2 bg-card p-4">
          <h3 className="font-display text-lg font-bold">Floors</h3>
          {[...doc.levels].sort((a, b) => a.level - b.level).map((l) => (
            <div key={l.level} className="flex items-center gap-2">
              <span className="w-10 font-mono text-xs">{l.level}</span>
              <input
                className="field flex-1 py-1.5"
                defaultValue={l.name}
                aria-label={`Floor ${l.level} name`}
                onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && commit({ ...doc, levels: doc.levels.map((x) => (x.level === l.level ? { ...x, name: e.target.value.trim() } : x)) })}
              />
              <button
                type="button"
                className="text-sm font-bold underline disabled:opacity-40"
                disabled={doc.levels.length === 1 || doc.areas.some((a) => a.level === l.level) || doc.markers.some((m) => m.level === l.level)}
                title="Only floors with nothing on them can be removed"
                onClick={() => commit({ ...doc, levels: doc.levels.filter((x) => x.level !== l.level) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm w-fit bg-card"
            onClick={() => {
              const next = Math.max(...doc.levels.map((l) => l.level)) + 1;
              commit({ ...doc, levels: [...doc.levels, { level: next, name: next === 1 ? "First floor" : `Floor ${next}` }] });
              setLevel(next);
            }}
          >
            + Add a floor
          </button>
        </section>

        <section className="card-pop grid gap-2 bg-card p-4">
          <h3 className="font-display text-lg font-bold">Sections</h3>
          <p className="text-xs text-muted-foreground">The big signposted parts: wings, zones, terminals. Areas take their colour.</p>
          {doc.sections.map((s) => (
            <div key={s.code} className="flex items-center gap-2">
              <input
                type="color"
                value={s.color ?? "#999999"}
                aria-label={`${s.name} colour`}
                onChange={(e) => commit({ ...doc, sections: doc.sections.map((x) => (x.code === s.code ? { ...x, color: e.target.value } : x)) })}
                className="h-8 w-8 rounded border-2 border-ink"
              />
              <span className="w-10 font-mono text-xs font-bold">{s.code}</span>
              <input
                className="field flex-1 py-1.5"
                defaultValue={s.name}
                aria-label={`Section ${s.code} name`}
                onBlur={(e) => e.target.value.trim() && commit({ ...doc, sections: doc.sections.map((x) => (x.code === s.code ? { ...x, name: e.target.value.trim() } : x)) })}
              />
              <button
                type="button"
                className="text-sm font-bold underline disabled:opacity-40"
                disabled={doc.areas.some((a) => a.section === s.code)}
                title="Only sections with no areas can be removed"
                onClick={() => commit({ ...doc, sections: doc.sections.filter((x) => x.code !== s.code) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm w-fit bg-card"
            onClick={() => {
              const used = new Set(doc.sections.map((s) => s.code));
              const code = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("").find((c) => !used.has(c)) ?? uniqueCode("S", used);
              commit({ ...doc, sections: [...doc.sections, { code, name: `Zone ${code}`, color: "#1E5BFF" }] });
            }}
          >
            + Add a section
          </button>
        </section>
      </aside>
    </div>
  );
}

/** Exact numbers for the selected shape (for people who measured on the site walk). */
function ShapeNumbers({ shape, onChange }: { shape: Shape; onChange: (s: Shape) => void }) {
  const fields: [string, number][] =
    shape.type === "rect"
      ? [["x", shape.x], ["y", shape.y], ["w", shape.w], ["h", shape.h]]
      : shape.type === "circle"
        ? [["cx", shape.cx], ["cy", shape.cy], ["r", shape.r]]
        : shape.type === "sector"
          ? [["cx", shape.cx], ["cy", shape.cy], ["r0", shape.r0], ["r1", shape.r1], ["a0", shape.a0], ["a1", shape.a1]]
          : [];
  if (!fields.length) return <p className="text-xs">Shape with {shape.type === "polygon" ? shape.points.length : 0} corners. Drag it to move.</p>;
  return (
    <details>
      <summary className="cursor-pointer text-sm font-bold">Exact size and position</summary>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {fields.map(([k, v]) => (
          <label key={`${k}${v}`} className="text-xs font-bold">
            {k}
            <input
              className="field mt-0.5 py-1 text-sm"
              type="number"
              step="0.5"
              defaultValue={v}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n !== v) onChange({ ...shape, [k]: n } as Shape);
              }}
            />
          </label>
        ))}
      </div>
      {shape.type === "sector" && <p className="mt-1 text-[11px]">Angles in degrees clockwise from 12 o'clock. r0 = inner edge, r1 = outer edge.</p>}
    </details>
  );
}

/** Round venues (stadiums, theatres): add a circle or a ring slice by numbers. */
function RoundAreaForm({ canvas, onAdd }: { canvas: VenuePlan["canvas"]; onAdd: (s: Shape) => void }) {
  const [v, setV] = useState({ cx: canvas.width / 2, cy: canvas.height / 2, r0: 20, r1: 35, a0: 0, a1: 45 });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: Number(e.target.value) });
  return (
    <details className="card-pop bg-card p-4">
      <summary className="cursor-pointer font-display text-lg font-bold">Round venue? Add a ring slice</summary>
      <p className="mt-1 text-xs text-muted-foreground">
        For stadiums and round theatres: a slice of a ring around a centre point. Angles are clockwise from 12 o'clock (0 = top, 90 = right).
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(Object.keys(v) as (keyof typeof v)[]).map((k) => (
          <label key={k} className="text-xs font-bold">
            {{ cx: "Centre x", cy: "Centre y", r0: "Inner radius", r1: "Outer radius", a0: "From angle", a1: "To angle" }[k]}
            <input className="field mt-0.5 py-1 text-sm" type="number" value={v[k]} onChange={set(k)} />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm bg-sun" disabled={v.r1 <= v.r0 || v.a1 <= v.a0} onClick={() => onAdd({ type: "sector", ...v })}>
          + Add ring slice
        </button>
        <button type="button" className="btn btn-sm bg-card" disabled={v.r1 <= 0} onClick={() => onAdd({ type: "circle", cx: v.cx, cy: v.cy, r: v.r1 })}>
          + Add circle (outer radius)
        </button>
      </div>
    </details>
  );
}
