import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/**
 * "← Back": goes to the previous page in this tab, or up one level
 * (/admin/print → /admin) when the page was opened directly, e.g. from a QR scan.
 */
export function BackButton({ path, className }: { path: string; className?: string }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate();
  const parent = path.split("/").slice(0, -1).join("/") || "/";

  return (
    <button
      type="button"
      onClick={() => {
        if (canGoBack) router.history.back();
        else void navigate({ to: parent });
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-card px-3 py-1 text-sm font-bold shadow-pop transition hover:-translate-y-0.5 print:hidden",
        className,
      )}
    >
      <span aria-hidden="true">←</span> Back
    </button>
  );
}
