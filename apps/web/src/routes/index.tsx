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

        <section className="mt-20" aria-labelledby="build">
          <span className="chip bg-lilac">For event planners and platforms</span>
          <h2 id="build" className="mt-3 text-3xl font-extrabold md:text-4xl">
            Build on Layovr
          </h2>
          <p className="mt-2 max-w-2xl text-lg">
            Run seat delivery at your event from our dashboard, or plug it into the event app, ticketing platform or AI assistant you already use.
          </p>
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <Link to="/dashboard/signup" className="card-pop flex flex-col gap-2 bg-sun p-6 transition hover:-translate-y-1">
              <div className="text-4xl">🎪</div>
              <h3 className="text-2xl font-extrabold">Run it at your event</h3>
              <p>
                Pick your venue (Landmark, Eko Convention Centre, National Theatre…) or draw your own map, invite vendors, add runners or let us
                bring ours.
              </p>
              <span className="btn btn-sm mt-auto w-fit bg-card">Create a partner account →</span>
            </Link>
            <a href="/developers#reference" className="card-pop flex flex-col gap-2 bg-card p-6 transition hover:-translate-y-1">
              <div className="text-4xl">📘</div>
              <h3 className="text-2xl font-extrabold">API documentation</h3>
              <p>Events, venue plans, vendors, staff and orders over REST, with an interactive reference and an OpenAPI file.</p>
              <pre className="mt-1 overflow-x-auto rounded-xl border-2 border-ink bg-ink p-3 text-[11px] text-ink-foreground">
                <code>{`POST /api/partner/events
Authorization: Bearer lvk_…
{ "name": "Lagos Tech Fest",
  "templateCode": "LANDMARK-CENTRE" }`}</code>
              </pre>
              <span className="btn btn-sm mt-auto w-fit bg-sun">Read the docs →</span>
            </a>
            <a href="/developers#mcp" className="card-pop flex flex-col gap-2 bg-mint p-6 transition hover:-translate-y-1">
              <div className="text-4xl">🤖</div>
              <h3 className="text-2xl font-extrabold">Connect via MCP</h3>
              <p>
                Give Claude, Cursor, VS Code or your platform's agent Layovr tools. “Add Mama Put with jollof at ₦4,500 and block the side
                entrance.” Changes are previewed before they apply.
              </p>
              <span className="btn btn-sm mt-auto w-fit bg-card">Set up MCP →</span>
            </a>
          </div>
        </section>
      </Section>
    </>
  );
}
