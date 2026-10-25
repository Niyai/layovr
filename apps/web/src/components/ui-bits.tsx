import type { ReactNode } from "react";
import { STATUS_LABEL, formatNaira } from "@/lib/store";
import type { OrderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Big coloured band at the top of a page, as on the live site. */
export function PageHero({
  eyebrow,
  title,
  children,
  fill = "bg-coral",
  aside,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  fill?: string;
  aside?: ReactNode;
}) {
  return (
    <section className={cn("border-b-2 border-ink", fill)}>
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-14 md:grid-cols-[1.3fr_1fr] md:py-20">
        <div>
          <span className="inline-block rounded-full border-2 border-ink bg-card px-3 py-1 text-xs font-bold uppercase tracking-wider">
            {eyebrow}
          </span>
          <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] md:text-6xl">
            {title}
          </h1>
          {children && <div className="mt-5 max-w-xl text-lg">{children}</div>}
        </div>
        {aside}
      </div>
    </section>
  );
}

export function Section({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mx-auto max-w-7xl px-5 py-16 md:py-20", className)}>
      {children}
    </section>
  );
}

export function Note({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "rounded-2xl border-2 border-dashed border-ink bg-sun/40 px-4 py-3 text-sm font-medium",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function EmptyCard({
  emoji,
  title,
  children,
  action,
}: {
  emoji: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card-pop mx-auto max-w-xl bg-lilac p-10 text-center">
      <div className="text-6xl">{emoji}</div>
      <h1 className="mt-3 text-3xl font-extrabold">{title}</h1>
      {children && <div className="mt-2">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

const STATUS_FILL: Record<OrderStatus, string> = {
  awaiting_payment: "bg-muted",
  paid: "bg-sun",
  assigned: "bg-lilac",
  buying: "bg-blush",
  on_the_way: "bg-coral",
  delivered: "bg-mint",
  not_delivered: "bg-destructive text-destructive-foreground",
  cancelled: "bg-muted",
};

export function StatusChip({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  return (
    <span className={cn("chip", STATUS_FILL[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Money({
  kobo,
  className,
}: {
  kobo: number;
  className?: string;
}) {
  return (
    <span className={cn("tabular-nums", className)}>{formatNaira(kobo)}</span>
  );
}

export function QtyStepper({
  qty,
  onChange,
  label,
}: {
  qty: number;
  onChange: (q: number) => void;
  label: string;
}) {
  return (
    <div
      className="inline-flex items-center rounded-full border-2 border-ink bg-card"
      role="group"
      aria-label={`Quantity of ${label}`}
    >
      <button
        type="button"
        className="h-9 w-9 rounded-full font-bold hover:bg-muted"
        aria-label={`Remove one ${label}`}
        onClick={() => onChange(qty - 1)}
      >
        −
      </button>
      <span
        className="w-7 text-center font-bold tabular-nums"
        aria-live="polite"
      >
        {qty}
      </span>
      <button
        type="button"
        className="h-9 w-9 rounded-full font-bold hover:bg-muted"
        aria-label={`Add one ${label}`}
        onClick={() => onChange(qty + 1)}
      >
        +
      </button>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold">{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}
