import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { EmptyCard, Money, Section } from "@/components/ui-bits";
import {
  demoPay,
  formatNaira,
  rememberOrder,
  startPayment,
  useDB,
  useHydrated,
  verifyPayment,
} from "@/lib/store";

const searchSchema = z.object({
  demo: z.coerce.number().optional(),
  status: z.string().optional(),
  tx_ref: z.string().optional(),
  transaction_id: z.coerce.string().optional(),
});

/**
 * Payment hand-off and return page.
 * - Flutterwave redirects here with ?status=…&tx_ref=…&transaction_id=…
 * - In demo mode (?demo=1) it shows a stand-in checkout that moves no money.
 */
export const Route = createFileRoute("/pay/$orderId")({
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({ meta: [{ title: "Payment · Layovr" }] }),
  component: PayPage,
});

function PayPage() {
  const { orderId } = Route.useParams();
  const search = Route.useSearch();
  const d = useDB();
  const hydrated = useHydrated();
  const navigate = useNavigate();
  const order = d.orders.find((o) => o.id === orderId);
  const [state, setState] = useState<
    "idle" | "verifying" | "failed" | "cancelled"
  >(search.status === "cancelled" ? "cancelled" : "idle");
  const [retrying, setRetrying] = useState(false);
  const verifiedOnce = useRef(false);

  const [checked, setChecked] = useState(false);
  useEffect(() => {
    void rememberOrder(orderId).then(() => setChecked(true));
  }, [orderId]);

  useEffect(() => {
    if (!hydrated || !order) return;
    if (order.status !== "awaiting_payment") {
      void navigate({
        to: "/o/$orderId",
        params: { orderId: order.id },
        replace: true,
      });
      return;
    }
    const txId = search.transaction_id;
    if (
      verifiedOnce.current ||
      !txId ||
      (search.status !== "successful" && search.status !== "completed")
    )
      return;
    verifiedOnce.current = true;
    setState("verifying");
    // The server checks the transaction with Flutterwave (amount, currency,
    // tx_ref) and marks the order paid; the webhook does the same.
    verifyPayment(order.id, txId)
      .then((ok) => {
        if (!ok) setState("failed");
      })
      .catch(() => setState("failed"));
  }, [hydrated, order?.status, search.transaction_id]);

  if (!hydrated || (!order && !checked))
    return (
      <Section>
        <p className="text-center text-lg">Loading your order…</p>
      </Section>
    );

  if (!order) {
    return (
      <Section>
        <EmptyCard
          emoji="🔎"
          title="We can't find that order on this phone"
          action={
            <Link to="/track" className="btn bg-coral">
              Look it up
            </Link>
          }
        >
          <p>If you paid, look it up with your phone number.</p>
        </EmptyCard>
      </Section>
    );
  }

  const retry = async () => {
    setRetrying(true);
    try {
      const res = await startPayment(order.id);
      if (res.mode === "demo") {
        setState("idle");
        await navigate({
          to: "/pay/$orderId",
          params: { orderId: order.id },
          search: { demo: 1 },
        });
      } else window.location.assign(res.link);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  };

  if (state === "verifying") {
    return (
      <Section>
        <EmptyCard emoji="⏳" title="Checking your payment…">
          <p>This takes a few seconds.</p>
        </EmptyCard>
      </Section>
    );
  }

  if (state === "failed" || state === "cancelled") {
    return (
      <Section>
        <EmptyCard
          emoji={state === "failed" ? "😕" : "💾"}
          title={
            state === "failed"
              ? "We couldn't confirm that payment"
              : "Payment cancelled"
          }
          action={
            <button
              type="button"
              className="btn bg-coral"
              disabled={retrying}
              onClick={() => void retry()}
            >
              Pay {formatNaira(order.totalKobo)}
            </button>
          }
        >
          <p>
            {state === "failed"
              ? "If money left your account, don't pay again. Show order " +
                order.code +
                " to a Layovr runner or call us."
              : `Your order ${order.code} is saved, you can pay when you're ready.`}
          </p>
        </EmptyCard>
      </Section>
    );
  }

  if (search.demo) {
    return (
      <Section>
        <div className="card-pop mx-auto max-w-md bg-card p-8">
          <span className="chip bg-sun">Demo payment · no money moves</span>
          <h1 className="mt-4 text-3xl font-extrabold">
            Approve this test payment?
          </h1>
          <p className="mt-2 text-muted-foreground">
            Set FLW_SECRET_KEY on the API to use Flutterwave's real checkout.
            Until then this screen stands in for it.
          </p>
          <dl className="mt-6 grid gap-1 rounded-2xl border-2 border-ink p-4">
            <div className="flex justify-between">
              <dt>Order</dt>
              <dd className="font-mono font-bold">{order.code}</dd>
            </div>
            <div className="flex justify-between text-xl font-extrabold">
              <dt>Amount</dt>
              <dd>
                <Money kobo={order.totalKobo} />
              </dd>
            </div>
          </dl>
          <div className="mt-6 grid gap-3">
            <button
              type="button"
              className="btn bg-coral"
              onClick={() => void demoPay(order.id)}
            >
              Approve payment
            </button>
            <button
              type="button"
              className="btn bg-card"
              onClick={() => setState("cancelled")}
            >
              Cancel
            </button>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section>
      <EmptyCard
        emoji="💳"
        title="Finish paying for your order"
        action={
          <button
            type="button"
            className="btn bg-coral"
            disabled={retrying}
            onClick={() => void retry()}
          >
            Pay {formatNaira(order.totalKobo)}
          </button>
        }
      >
        <p>Order {order.code} is saved and waiting for payment.</p>
      </EmptyCard>
    </Section>
  );
}
