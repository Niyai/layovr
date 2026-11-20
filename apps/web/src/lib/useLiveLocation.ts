import { distanceM } from "@layovr/shared";
import { useEffect, useRef, useState } from "react";

export type LiveLocationStatus = "off" | "on" | "denied" | "unavailable";
type Fix = { lat: number; lng: number; accuracyM: number };

/**
 * Sends the phone's position while enabled: at most every 15 s unless it has
 * moved 25 m or more. `send` resolves false when the server stopped storing it
 * (order closed, cart closed), which shows as "off". Used by runners, buyers
 * and mobile vendors.
 */
export function useLiveLocation(enabled: boolean, send: (fix: Fix) => Promise<boolean>): LiveLocationStatus {
  const [status, setStatus] = useState<LiveLocationStatus>("off");
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      return;
    }
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    let last: { t: number; lat: number; lng: number } | null = null;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const now = Date.now();
        if (last && now - last.t < 15_000 && distanceM(last.lat, last.lng, lat, lng) < 25) return;
        last = { t: now, lat, lng };
        void sendRef.current({ lat, lng, accuracyM: accuracy }).then((ok) => setStatus(ok ? "on" : "off"));
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return status;
}
