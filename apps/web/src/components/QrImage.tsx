import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function spotUrl(code: string): string {
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}/s/${code}`;
}

export function QrImage({
  value,
  size = 160,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, {
      margin: 1,
      width: size * 2,
      errorCorrectionLevel: "M",
      color: { dark: "#1d1b2b", light: "#ffffff" },
    })
      .then((url) => alive && setSrc(url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [value, size]);
  return src ? (
    <img
      src={src}
      width={size}
      height={size}
      alt={`QR code for ${value}`}
      className={className}
    />
  ) : (
    <div style={{ width: size, height: size }} className={className} />
  );
}

export async function downloadQr(code: string, label: string) {
  const url = await QRCode.toDataURL(spotUrl(code), {
    margin: 2,
    width: 1024,
    errorCorrectionLevel: "M",
  });
  const a = document.createElement("a");
  a.href = url;
  a.download = `layovr-${code}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  a.click();
}
