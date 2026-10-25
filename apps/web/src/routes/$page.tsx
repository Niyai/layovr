import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageHero, Section } from "@/components/ui-bits";

/**
 * Light info pages linked from the header and footer. Replace with your
 * existing Lovable versions if you already have them.
 */
type Info = {
  eyebrow: string;
  title: string;
  fill: string;
  intro: string;
  body: ReactNode;
};

const PAGES: Record<string, Info> = {
  "become-a-vendor": {
    eyebrow: "For vendors",
    title: "Sell to people who'd rather not leave their seat",
    fill: "bg-mint",
    intro:
      "At events, airports and malls, many buyers won't walk to your stall. Layovr brings them to you.",
    body: (
      <ul className="grid gap-4 md:grid-cols-3">
        {[
          [
            "🧾",
            "No sign-up to start",
            "Our runners buy from your stall at your normal prices and deliver for you.",
          ],
          [
            "📈",
            "More orders, same queue",
            "Reach people deep in the hall, the back rows and the VIP lounge.",
          ],
          [
            "🤝",
            "Go direct later",
            "Receive orders on your own screen and get paid automatically as we grow.",
          ],
        ].map(([e, t, l]) => (
          <li key={t} className="card-pop bg-card p-6">
            <div className="text-4xl">{e}</div>
            <h2 className="mt-3 text-xl font-extrabold">{t}</h2>
            <p className="mt-1">{l}</p>
          </li>
        ))}
      </ul>
    ),
  },
  partners: {
    eyebrow: "Partners",
    title: "Run Layovr at your venue, under your brand",
    fill: "bg-lilac",
    intro:
      "Airports, malls, offices, estates and event organisers: we map your space, place the codes and run deliveries with your stores.",
    body: (
      <p className="text-lg">
        Tell us about your venue and we'll show you a pilot plan.{" "}
        <a className="font-bold underline" href="mailto:hello@layovr.app">
          hello@layovr.app
        </a>
      </p>
    ),
  },
  about: {
    eyebrow: "About",
    title: "Making it easy to find the good stuff right around you",
    fill: "bg-blush",
    intro:
      "Layovr started in Lagos, delivering inside the places where maps stop being useful.",
    body: <p className="text-lg">Questions? Write to hello@layovr.app.</p>,
  },
  help: {
    eyebrow: "Help centre",
    title: "How can we help?",
    fill: "bg-sun",
    intro: "At an event, the fastest help is a Layovr runner or the ops desk.",
    body: (
      <ul className="grid gap-3 text-lg">
        <li>
          <b>Where's my order?</b>{" "}
          <Link className="underline" to="/track">
            Track it here
          </Link>
          .
        </li>
        <li>
          <b>An item was unavailable?</b> We refund that item to the card or
          account you paid with.
        </li>
        <li>
          <b>Paid but no order page?</b> Don't pay again. Show your bank alert
          to a runner, or write to hello@layovr.app.
        </li>
      </ul>
    ),
  },
  privacy: {
    eyebrow: "Privacy",
    title: "Privacy policy",
    fill: "bg-card",
    intro:
      "Draft placeholder: replace with your reviewed policy before launch.",
    body: (
      <p>
        We collect your name, phone number and spot so a runner can deliver your
        order. Payments are handled by Flutterwave.
      </p>
    ),
  },
  terms: {
    eyebrow: "Terms",
    title: "Terms of service",
    fill: "bg-card",
    intro: "Draft placeholder: replace with your reviewed terms before launch.",
    body: (
      <p>
        Prices are set by vendors. The service fee covers payment processing and
        delivery.
      </p>
    ),
  },
};

export const Route = createFileRoute("/$page")({
  loader: ({ params }) => {
    if (!PAGES[params.page]) throw notFound();
  },
  head: ({ params }) => ({
    meta: [{ title: `${PAGES[params.page]?.title ?? "Layovr"} · Layovr` }],
  }),
  component: InfoPage,
});

function InfoPage() {
  const { page } = Route.useParams();
  const info = PAGES[page];
  if (!info) return null;
  return (
    <>
      <PageHero eyebrow={info.eyebrow} title={info.title} fill={info.fill}>
        {info.intro}
      </PageHero>
      <Section>{info.body}</Section>
    </>
  );
}
