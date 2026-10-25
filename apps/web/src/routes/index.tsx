import { Link, createFileRoute } from "@tanstack/react-router";
import heroScan from "@/assets/hero-scan.jpg";
import { PageHero, Section } from "@/components/ui-bits";

export const Route = createFileRoute("/")({
  component: Home,
});

const PLACES = [
  {
    emoji: "🎤",
    name: "Events",
    fill: "bg-sun",
    line: "Stay in your seat. Snacks and drinks come to you.",
  },
  {
    emoji: "✈️",
    name: "Airports",
    fill: "bg-lilac",
    line: "Order before boarding, timed to your flight.",
  },
  {
    emoji: "🛍️",
    name: "Malls",
    fill: "bg-mint",
    line: "Shop the whole mall from one table.",
  },
  {
    emoji: "🏢",
    name: "Offices",
    fill: "bg-blush",
    line: "Lunch to your floor, desk or meeting room.",
  },
];

function Home() {
  return (
    <>
      <PageHero
        eyebrow="Close-by delivery"
        fill="bg-sun"
        title={
          <>
            Scan. Order.{" "}
            <span className="underline decoration-coral decoration-[6px] underline-offset-4">
              Stay put.
            </span>
          </>
        }
        aside={
          <img
            src={heroScan}
            alt="A phone scanning a Layovr code on a table"
            width={1024}
            height={1024}
            className="card-pop aspect-square w-full max-w-md justify-self-center object-cover shadow-pop-lg"
          />
        }
      >
        <p>
          Spot a Layovr code where you are, pick something from the vendors
          nearby, and a runner brings it straight to your spot. No app, no
          sign-up.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link to="/scan" className="btn bg-coral">
            Scan a code
          </Link>
          <Link to="/explore" className="btn bg-card">
            Explore vendors
          </Link>
        </div>
      </PageHero>

      <Section>
        <Link
          to="/l/$code"
          params={{ code: "MOONSHOT" }}
          className="card-pop flex flex-col items-start gap-4 bg-coral p-7 transition hover:-translate-y-1 md:flex-row md:items-center md:justify-between"
        >
          <div>
            <span className="chip">Live · Oct 28–29</span>
            <h2 className="mt-3 text-3xl font-extrabold">At Moonshot 2026?</h2>
            <p className="mt-1 text-lg">
              Scan the code on your seat or table at the National Theatre and
              we'll bring your order to you.
            </p>
          </div>
          <span className="btn bg-card">See who's serving →</span>
        </Link>

        <h2 className="mt-20 text-3xl font-extrabold md:text-4xl">
          Built for places where you'd rather not leave your spot
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLACES.map((p) => (
            <div key={p.name} className={`card-pop p-6 ${p.fill}`}>
              <div className="grid h-14 w-14 place-items-center rounded-full border-2 border-ink bg-card text-3xl">
                {p.emoji}
              </div>
              <h3 className="mt-4 text-xl font-extrabold">{p.name}</h3>
              <p className="mt-1">{p.line}</p>
            </div>
          ))}
        </div>

        <div className="mt-20 grid gap-6 md:grid-cols-3">
          {[
            [
              "📱",
              "Scan the code",
              "It already knows where you are: seat, table, gate or floor.",
            ],
            [
              "🛒",
              "Pick and pay",
              "Every vendor around you in one basket. Card, transfer or USSD.",
            ],
            [
              "🛵",
              "We bring it",
              "Follow your order live, then show your 4-digit code to collect.",
            ],
          ].map(([emoji, title, line], i) => (
            <div key={title} className="card-pop bg-card p-6">
              <div className="text-sm font-bold uppercase tracking-wider">
                Step {i + 1}
              </div>
              <div className="mt-2 text-4xl">{emoji}</div>
              <h3 className="mt-2 text-2xl font-extrabold">{title}</h3>
              <p className="mt-1">{line}</p>
            </div>
          ))}
        </div>
        <div className="mt-8">
          <Link to="/how-it-works" className="btn bg-card">
            The whole journey →
          </Link>
        </div>
      </Section>
    </>
  );
}
