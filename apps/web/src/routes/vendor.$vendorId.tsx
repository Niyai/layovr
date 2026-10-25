import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  EmptyCard,
  Money,
  Note,
  PageHero,
  QtyStepper,
  Section,
} from "@/components/ui-bits";
import {
  addToCart,
  confirmAge,
  formatNaira,
  setQty,
  useDB,
  useSession,
  vendorWait,
} from "@/lib/store";
import type { Product } from "@/lib/types";
import { cn, fillClass } from "@/lib/utils";

export const Route = createFileRoute("/vendor/$vendorId")({
  component: VendorMenu,
});

function VendorMenu() {
  const { vendorId } = Route.useParams();
  const d = useDB();
  const session = useSession();
  const [ageGate, setAgeGate] = useState<Product | null>(null);

  const vendor = d.vendors.find((v) => v.id === vendorId);
  const venue = vendor
    ? d.venues.find((v) => v.id === vendor.venueId)
    : undefined;
  if (!vendor || !venue) {
    return (
      <Section>
        <EmptyCard
          emoji="🍽️"
          title="This vendor isn't here any more"
          action={
            <Link to="/explore" className="btn bg-coral">
              Explore vendors
            </Link>
          }
        />
      </Section>
    );
  }

  const products = d.products.filter((p) => p.vendorId === vendor.id);
  const categories = [...new Set(products.map((p) => p.category))];
  const wait = vendorWait(d, vendor);
  const cartForVenue = session.cartVenueId === venue.id ? session.cart : [];
  const qtyOf = (id: string) =>
    cartForVenue.find((l) => l.productId === id)?.qty ?? 0;
  const basketCount = cartForVenue.reduce((n, l) => n + l.qty, 0);
  const basketTotal = cartForVenue.reduce(
    (s, l) =>
      s +
      (d.products.find((p) => p.id === l.productId)?.priceKobo ?? 0) * l.qty,
    0,
  );

  const add = (p: Product) => {
    if (p.ageRestricted && !session.ageConfirmed) {
      setAgeGate(p);
      return;
    }
    if (
      session.cartVenueId &&
      session.cartVenueId !== venue.id &&
      session.cart.length > 0
    ) {
      toast("Started a new basket for this location");
    }
    addToCart(p, venue.id);
    toast.success(`${p.name} added`);
  };

  return (
    <>
      <PageHero
        eyebrow={vendor.category}
        fill={fillClass[vendor.fill]}
        title={
          <>
            {vendor.emoji} {vendor.name}
          </>
        }
      >
        <p>{vendor.description}</p>
        <div className="mt-5 flex flex-wrap gap-2 text-sm font-bold">
          <span className="chip">📍 {vendor.stallLabel}</span>
          {vendor.isOpen ? (
            <span className="chip">⏱ ~{wait.minutes} min to you</span>
          ) : (
            <span className="chip bg-muted">Closed</span>
          )}
        </div>
        <Link
          to="/l/$code"
          params={{ code: venue.code }}
          className="mt-6 inline-block font-bold underline"
        >
          ← All vendors at {venue.name}
        </Link>
      </PageHero>

      <Section className="pb-32">
        {!vendor.isOpen && (
          <Note className="mb-8">
            This vendor is closed right now. You can look around, but ordering
            opens when they do.
          </Note>
        )}
        {categories.length > 1 && (
          <nav
            className="sticky top-[66px] z-30 -mx-5 mb-6 flex gap-2 overflow-x-auto bg-cream/95 px-5 py-3"
            aria-label="Menu sections"
          >
            {categories.map((c) => (
              <a
                key={c}
                href={`#cat-${c}`}
                className="chip whitespace-nowrap px-4 py-1.5 text-sm"
              >
                {c}
              </a>
            ))}
          </nav>
        )}

        {categories.map((c) => (
          <section key={c} id={`cat-${c}`} className="mb-12 scroll-mt-32">
            <h2 className="text-2xl font-extrabold">{c}</h2>
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {products
                .filter((p) => p.category === c)
                .map((p) => {
                  const qty = qtyOf(p.id);
                  return (
                    <li
                      key={p.id}
                      className={cn(
                        "card-pop flex gap-4 bg-card p-4",
                        !p.inStock && "opacity-60",
                      )}
                    >
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="h-20 w-20 shrink-0 rounded-xl border-2 border-ink object-cover"
                        />
                      ) : (
                        <div
                          className={cn(
                            "grid h-20 w-20 shrink-0 place-items-center rounded-xl border-2 border-ink text-3xl",
                            fillClass[vendor.fill],
                          )}
                        >
                          {vendor.emoji}
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-display text-lg font-bold leading-tight">
                            {p.name}
                          </h3>
                          <Money kobo={p.priceKobo} className="font-bold" />
                        </div>
                        {p.description && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {p.description}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {p.kind === "service" && (
                            <span className="chip bg-lilac">
                              Service · ~{p.durationMin} min
                            </span>
                          )}
                          {p.fulfilment === "collect_and_return" && (
                            <span className="chip">We collect & return</span>
                          )}
                          {p.ageRestricted && (
                            <span className="chip bg-blush">18+</span>
                          )}
                        </div>
                        <div className="mt-auto flex justify-end pt-3">
                          {!p.inStock ? (
                            <span className="chip bg-muted">Sold out</span>
                          ) : qty > 0 ? (
                            <QtyStepper
                              qty={qty}
                              label={p.name}
                              onChange={(q) => setQty(p.id, q)}
                            />
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm bg-sun"
                              disabled={!vendor.isOpen}
                              onClick={() => add(p)}
                            >
                              Add
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
      </Section>

      {basketCount > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 px-4">
          <Link
            to="/checkout"
            className="btn mx-auto flex max-w-md justify-between bg-coral"
          >
            <span>
              View basket · {basketCount} item{basketCount === 1 ? "" : "s"}
            </span>
            <span>{formatNaira(basketTotal)}</span>
          </Link>
        </div>
      )}

      {ageGate && (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-ink/60 p-4 sm:place-items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="age-title"
        >
          <div className="card-pop w-full max-w-md bg-card p-6">
            <h2 id="age-title" className="text-2xl font-extrabold">
              Are you 18 or older?
            </h2>
            <p className="mt-2">
              You must be 18+ to buy {ageGate.name}. Your runner may ask for ID
              at hand-off.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="btn flex-1 bg-coral"
                onClick={() => {
                  confirmAge();
                  addToCart(ageGate, venue.id);
                  toast.success(`${ageGate.name} added`);
                  setAgeGate(null);
                }}
              >
                I'm 18 or older
              </button>
              <button
                type="button"
                className="btn flex-1 bg-card"
                onClick={() => setAgeGate(null)}
              >
                I'm under 18
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
