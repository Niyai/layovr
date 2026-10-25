import type { DB } from "@/lib/types";

export function SpotPicker({
  d,
  venueId,
  value,
  onChange,
  id,
}: {
  d: DB;
  venueId: string;
  value: string | undefined;
  onChange: (spotId: string) => void;
  id?: string;
}) {
  const zones = d.zones.filter((z) => z.venueId === venueId);
  const spots = d.spots.filter((s) => s.venueId === venueId && s.active);
  return (
    <select
      id={id}
      className="field"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      required
    >
      <option value="" disabled>
        Choose where you are…
      </option>
      {zones.map((z) => (
        <optgroup key={z.id} label={z.name}>
          {spots
            .filter((s) => s.zoneId === z.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.code})
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}
