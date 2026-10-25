import { Link, createFileRoute } from "@tanstack/react-router";
import heroScan from "@/assets/hero-scan.jpg";
import { PageHero, Section } from "@/components/ui-bits";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({ meta: [{ title: "How it works · Layovr" }] }),
  component: HowItWorks,
});

const STEPS = [
  {
    emoji: "📱",
    fill: "bg-sun",
    title: "Find or scan a Layovr code",
    body: "Spot a Layovr QR code at a participating place and point your phone camera at it. The code tells us exactly where you are. Can't scan? Just type the short code instead.",
  },
  {
    emoji: "🧭",
    fill: "bg-lilac",
    title: "Explore who's around",
    body: "You'll see the vendors serving that exact location, who's open right now, and roughly how long an order takes to reach you.",
  },
  {
    emoji: "🛒",
    fill: "bg-mint",
    title: "Browse and check what's in stock",
    body: "Have a look at products and prices, and we'll let you know if something has sold out. You can mix items from different vendors in one basket.",
  },
  {
    emoji: "✅",
    fill: "bg-blush",
    title: "Place your order",
    body: "Add your name and phone number, check your spot, and pay by card, bank transfer or USSD. A small service fee covers the payment charge and your runner.",
  },
  {
    emoji: "🛵",
    fill: "bg-coral",
    title: "Follow along",
    body: "We'll keep you posted as a runner picks up your order and heads your way. Show your 4-digit code when they arrive.",
  },
];

function HowItWorks() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        fill="bg-lilac"
        title="Finding good stuff nearby should feel easy"
        aside={
          <img
            alt=""
            width={1024}
            height={1024}
            className="card-pop aspect-square w-full max-w-md justify-self-center object-cover shadow-pop-lg"
            src={heroScan}
          />
        }
      >
        Here's the whole journey, from spotting a code to enjoying what you
        ordered.
      </PageHero>
      <Section>
        <ol className="relative grid gap-6">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className={`card-pop grid items-center gap-5 p-6 md:grid-cols-[auto_1fr] md:p-8 ${s.fill}`}
            >
              <div className="grid h-20 w-20 place-items-center rounded-full border-2 border-ink bg-card text-4xl">
                {s.emoji}
              </div>
              <div>
                <div className="text-sm font-bold uppercase tracking-wider">
                  Step {i + 1}
                </div>
                <h2 className="text-2xl font-extrabold md:text-3xl">
                  {s.title}
                </h2>
                <p className="mt-2 text-lg">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-10 rounded-2xl border-2 border-dashed border-ink bg-card p-5">
          Just so you know, what you can do depends on the location, the vendors
          taking part and the services they offer there, so options may look a
          little different from place to place.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/scan" className="btn bg-coral">
            Try scanning a code
          </Link>
          <Link to="/explore" className="btn bg-card">
            Explore vendors
          </Link>
        </div>
      </Section>
    </>
  );
}
