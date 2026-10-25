import { uid } from "@layovr/shared";
import type { Queryable } from "../db/client";
import { bad } from "./errors";

const MAX_BYTES = 2_000_000;
const DATA_URL = /^data:(image\/(?:webp|jpeg|png|gif));base64,([A-Za-z0-9+/=]+)$/;

/**
 * The web app sends photos as data URLs (already compressed in the browser).
 * We store them in the uploads table and keep only a short URL on the row,
 * so snapshots stay small on event mobile data.
 */
export async function persistImage(
  q: Queryable,
  venueId: string,
  value: string | undefined | null,
): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("/api/uploads/") || /^https:\/\//.test(value)) return value;
  const m = DATA_URL.exec(value);
  if (!m?.[1] || !m[2]) throw bad("Photos must be an image");
  const data = Buffer.from(m[2], "base64");
  if (data.length > MAX_BYTES) throw bad("That photo is too large");
  const id = uid("img", 16);
  await q.query(
    "insert into uploads (id, venue_id, content_type, data) values ($1, $2, $3, $4)",
    [id, venueId, m[1], data],
  );
  return `/api/uploads/${id}`;
}
