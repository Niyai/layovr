import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { SpotPicker } from "@/components/SpotPicker";
import {
  EmptyCard,
  Field,
  Money,
  QtyStepper,
  Section,
} from "@/components/ui-bits";
import {
  feeFor,
  formatNaira,
  placeOrder,
  setQty,
  setSpot,
  useDB,
  useSession,
} from "@/lib/store";
import { fillClass } from "@/lib/utils";

export const Route = createFileRoute("/checkout")({
  head: () => ({ meta: [{ title: "Your basket · Layovr" }] }),
  component: Checkout,
});

const PHONE_RE = /^\+?[0-9 ]{10,15}$/;

function Checkout() {
  const d = useDB();
  const session = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [landmark, setLandmark] = useState("");
  const [busy, setBusy] = useState(false);

  const venue = d.venues.find((v) => v.id === session.cartVenueId);
  const lines = session.cart
    .map((l) => ({
      line: l,
      product: d.products.find((p) => p.id === l.productId),
    }))
    .filter(
      (
        x,
      ): x is { line: typeof x.line; product: NonNullable<typeof x.product> } =>
        Boolean(x.product),
    );

  if (!venue || lines.length === 0) {
    return (
      <Section>
        <EmptyCard
          emoji="🧺"
          title="Your basket is feeling a bit empty"
          action={
            <Link to="/explore" className="btn bg-coral">
              Find vendors near you
            </Link>
          }
        >
          <p>
            Find a location, pick something you love and it'll show up right
            here.
          </p>
        </EmptyCard>
        {session.myOrderIds.length > 0 && (
          <p className="mt-8 text-center">
            Looking for an order you placed?{" "}
            <Link to="/track" className="font-bold underline">
              Track it here
            </Link>
          </p>
        )}
      </Section>
    );
  }

  const vendorIds = [...new Set(lines.map((x) => x.product.vendorId))];
  const subtotal = lines.reduce(
    (s, x) => (x.product.inStock ? s + x.product.priceKobo * x.line.qty : s),
    0,
  );
  const fee = feeFor(venue, subtotal);
  const spotOk = d.spots.some(
    (s) => s.id === session.spotId && s.venueId === venue.id,
  );
  const soldOut = lines.filter((x) => !x.product.inStock);

  const pay = async () => {
    if (!spotOk) {
      toast.error("Tell us where you are so the runner can find you.");
      return;
    }
    if (!name.trim()) {
      toast.error("Please enter your name.");
      return;
    }
    if (!PHONE_RE.test(phone.trim())) {
      toast.error("Please enter a valid phone number.");
      return;
    }
    setBusy(true);
    try {
      const { order, payment: res } = await placeOrder({
        venueId: venue.id,
        spotId: session.spotId ?? "",
        name,
        phone,
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
      });
      if (res.mode === "demo") {
        await navigate({
          to: "/pay/$orderId",
          params: { orderId: order.id },
          search: { demo: 1 },
        });
      } else {
        window.location.assign(res.link);
      }
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Couldn't start payment. Please try again.",
      );
      setBusy(false);
    }
  };

  return (
    <Section>
      <h1 className="text-4xl font-extrabold md:text-5xl">Your basket</h1>
      <p className="mt-2 text-lg">
        From {venue.name}. A Layovr runner picks everything up and brings it to
        you.
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-6">
          {vendorIds.map((vid) => {
            const vendor = d.vendors.find((v) => v.id === vid);
            return (
              <div key={vid} className="card-pop bg-card">
                <div
                  className={`flex items-center justify-between rounded-t-[calc(var(--radius-2xl)-2px)] border-b-2 border-ink px-5 py-3 ${vendor ? fillClass[vendor.fill] : ""}`}
                >
                  <h2 className="font-display text-lg font-bold">
                    {vendor?.emoji} {vendor?.name}
                  </h2>
                  <Link
                    to="/vendor/$vendorId"
                    params={{ vendorId: vid }}
                    className="text-sm font-bold underline"
                  >
                    Add more
                  </Link>
                </div>
                <ul className="divide-y-2 divide-ink/10 px-5">
                  {lines
                    .filter((x) => x.product.vendorId === vid)
                    .map(({ line, product }) => (
                      <li
                        key={product.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-4"
                      >
                        <div>
                          <div className="font-bold">{product.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {product.inStock
                              ? `${formatNaira(product.priceKobo)} each`
                              : "Sold out, won't be charged"}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <QtyStepper
                            qty={line.qty}
                            label={product.name}
                            onChange={(q) => setQty(product.id, q)}
                          />
                          <Money
                            kobo={product.priceKobo * line.qty}
                            className="w-20 text-right font-bold"
                          />
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
          {soldOut.length > 0 && (
            <p className="rounded-2xl border-2 border-dashed border-ink bg-blush/40 p-4 text-sm font-medium">
              {soldOut.length} item{soldOut.length === 1 ? " has" : "s have"}{" "}
              sold out since you added {soldOut.length === 1 ? "it" : "them"}.
            </p>
          )}
        </div>

        <form
          className="card-pop h-fit bg-sun p-6 lg:sticky lg:top-24"
          onSubmit={(e) => {
            e.preventDefault();
            void pay();
          }}
        >
          <h2 className="text-2xl font-extrabold">Where should we bring it?</h2>
          <div className="mt-5 grid gap-4">
            <Field label="Your spot">
              <SpotPicker
                d={d}
                venueId={venue.id}
                value={spotOk ? session.spotId : undefined}
                onChange={setSpot}
              />
            </Field>
            <Field
              label="Anything that helps us find you?"
              hint="Optional, e.g. ‘blue shirt, aisle seat’"
            >
              <input
                className="field"
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
                maxLength={80}
              />
            </Field>
            <Field label="Your name">
              <input
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="given-name"
                required
              />
            </Field>
            <Field
              label="Phone number"
              hint="So your runner can call if they can't find you. We'll text your order link."
            >
              <input
                className="field"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                autoComplete="tel"
                placeholder="080…"
                required
              />
            </Field>
            <Field label="Email for your receipt" hint="Optional">
              <input
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="email"
              />
            </Field>
          </div>

          <dl className="mt-6 grid gap-2 border-t-2 border-ink pt-4">
            <div className="flex justify-between">
              <dt>Items</dt>
              <dd>
                <Money kobo={subtotal} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>
                Service fee
                <span className="block text-xs">
                  Payment charge + your runner
                </span>
              </dt>
              <dd>
                <Money kobo={fee} />
              </dd>
            </div>
            <div className="flex justify-between border-t-2 border-ink pt-2 text-xl font-extrabold">
              <dt>Total</dt>
              <dd>
                <Money kobo={subtotal + fee} />
              </dd>
            </div>
          </dl>
          <button
            type="submit"
            className="btn mt-6 w-full bg-coral text-lg"
            disabled={busy || subtotal === 0}
          >
            {busy ? "Starting payment…" : `Pay ${formatNaira(subtotal + fee)}`}
          </button>
          <p className="mt-3 text-center text-xs">
            Card, bank transfer or USSD, secured by Flutterwave.
          </p>
        </form>
      </div>
    </Section>
  );
}
