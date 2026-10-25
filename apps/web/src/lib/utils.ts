import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Fill } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fillClass: Record<Fill, string> = {
  sun: "bg-sun",
  coral: "bg-coral",
  lilac: "bg-lilac",
  mint: "bg-mint",
  blush: "bg-blush",
  card: "bg-card",
};

export function minutesFromNow(iso?: string): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min ago`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Shrinks a photo in the browser before upload (event mobile data is slow). */
export async function compressImage(
  file: File,
  maxSide = 900,
  quality = 0.72,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", quality);
}
