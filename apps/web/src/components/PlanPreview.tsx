import { shapeCentre, shapePath, type VenuePlanInput } from "@layovr/shared";

/** A small read-only drawing of a plan file's ground floor (template previews). */
export function PlanPreview({ plan, className }: { plan: VenuePlanInput; className?: string }) {
  const { width, height } = plan.canvas;
  const ground = Math.min(...plan.levels.map((l) => l.level));
  const colors = new Map((plan.sections ?? []).map((s) => [s.code, s.color ?? "#999999"]));
  const areas = plan.areas.filter((a) => a.level === undefined || a.level === ground);
  const u = width / 100;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={`Plan of ${plan.venue.name}`}>
      <rect width={width} height={height} fill="#f3ede1" />
      {areas.map((a) => (
        <path
          key={a.code}
          d={shapePath(a.shape)}
          fill={(a.section && colors.get(a.section)) || "#F4B942"}
          fillOpacity={0.3}
          stroke="#1d1b2b"
          strokeWidth={0.4 * u}
          strokeDasharray={a.approximate ? `${u} ${u}` : undefined}
        />
      ))}
      {areas.map((a) => {
        const [x, y] = shapeCentre(a.shape);
        return (
          <text key={`t${a.code}`} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={3 * u} fontWeight={700} fill="#1d1b2b">
            {a.code}
          </text>
        );
      })}
    </svg>
  );
}
