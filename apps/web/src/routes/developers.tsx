import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { McpConnect } from "@/components/McpConnect";
import { PageHero, Section } from "@/components/ui-bits";
import { papi, refresh, useMe } from "@/lib/partnerApi";
import { useOrigin } from "@/lib/utils";

export const Route = createFileRoute("/developers")({
  head: () => ({
    meta: [
      { title: "Developers · Layovr API and MCP" },
      { name: "description", content: "Connect your event app, ticketing platform or AI assistant to Layovr with the REST API or MCP." },
    ],
  }),
  component: Developers,
});

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-2xl border-2 border-ink bg-ink p-4 text-xs leading-relaxed text-ink-foreground">
        <code>{children}</code>
      </pre>
      <button
        type="button"
        className="btn btn-sm absolute right-2 top-2 bg-sun"
        onClick={() => void navigator.clipboard?.writeText(children).then(() => toast.success("Copied"))}
      >
        Copy
      </button>
    </div>
  );
}

function Developers() {
  const me = useMe();
  const [key, setKey] = useState<string | undefined>();
  const base = `${useOrigin() || "https://layovr.app"}/api`;
  const createKey = async () => {
    try {
      const k = await papi<{ key: string }>("/partner/keys", { body: { name: "MCP (from docs page)" } });
      setKey(k.key);
      await refresh(["keys"]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <PageHero eyebrow="Developers" fill="bg-lilac" title="Build on Layovr">
        <p>
          Already run an event app, ticketing platform or venue system? Add seat delivery to it. Everything in the Layovr dashboard is available
          through a REST API and an MCP server for AI assistants.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="#mcp" className="btn bg-sun">
            Connect via MCP
          </a>
          <a href="#reference" className="btn bg-card">
            API reference
          </a>
          <Link to={me.data ? "/dashboard/keys" : "/dashboard/signup"} className="btn bg-card">
            {me.data ? "Your API keys" : "Get an API key"}
          </Link>
        </div>
      </PageHero>

      <Section className="grid gap-10">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            ["1. Get a key", "Sign up as a partner, then create an API key in the dashboard. Keys can be read-only."],
            ["2. Authenticate", "Send it on every request: Authorization: Bearer lvk_… . Money is always in kobo."],
            ["3. Map, stock, staff, publish", "Create an event from a venue template, edit its plan, add vendors and staff, then publish."],
          ].map(([t, d]) => (
            <div key={t} className="card-pop bg-card p-5">
              <h2 className="font-display text-lg font-bold">{t}</h2>
              <p className="mt-1 text-sm">{d}</p>
            </div>
          ))}
        </div>

        <section id="mcp" className="card-pop scroll-mt-24 bg-sun p-6">
          <h2 className="text-3xl font-extrabold">Connect via MCP</h2>
          <p className="mt-2 max-w-3xl">
            The Model Context Protocol lets AI assistants and agent platforms use Layovr directly. Point Claude, Cursor, VS Code or your own
            event manager's agent at our MCP server and ask in plain words: “set up Lagos Tech Fest at Landmark Centre on 5 December, add Mama Put
            with jollof at ₦4,500, and block the side entrance”. Changes are previewed first and only applied when you confirm.
          </p>
          {!me.data && (
            <p className="mt-3 text-sm">
              <Link to="/dashboard/signup" className="font-bold underline">
                Create a partner account
              </Link>{" "}
              or{" "}
              <Link to="/dashboard/login" className="font-bold underline">
                sign in
              </Link>{" "}
              to generate a key here.
            </p>
          )}
          <div className="mt-5">
            <McpConnect apiKey={key} onCreateKey={me.data ? () => void createKey() : undefined} />
          </div>
        </section>

        <section className="grid gap-4">
          <h2 className="text-3xl font-extrabold">REST quickstart</h2>
          <p>
            Base URL <code className="font-mono">{base}</code>. Errors are JSON <code>{"{ error }"}</code> with a 4xx status.
          </p>
          <h3 className="font-display text-lg font-bold">Create an event from a Lagos venue template</h3>
          <Code>{`curl -s ${base}/partner/events \\
  -H "Authorization: Bearer $LAYOVR_KEY" -H "Content-Type: application/json" \\
  -d '{
    "name": "Lagos Tech Fest 2026",
    "startsAt": "2026-12-05T09:00:00+01:00",
    "location": { "address": "Landmark Centre, Oniru", "lat": 6.4278, "lng": 3.4447 },
    "templateCode": "LANDMARK-CENTRE",
    "deliveryMode": "own_runners"
  }'`}</Code>
          <h3 className="font-display text-lg font-bold">Read the plan, edit it, save it</h3>
          <Code>{`curl -s ${base}/partner/events/$EVENT_ID/plan -H "Authorization: Bearer $LAYOVR_KEY" > plan.json
# edit plan.json (layovr-plan/1: floors, areas, QR spots, entrances), then check and save:
curl -s -X PUT "${base}/partner/events/$EVENT_ID/plan?dryRun=1" -H "Authorization: Bearer $LAYOVR_KEY" \\
  -H "Content-Type: application/json" --data @plan.json
curl -s -X PUT "${base}/partner/events/$EVENT_ID/plan?prune=1" -H "Authorization: Bearer $LAYOVR_KEY" \\
  -H "Content-Type: application/json" --data @plan.json`}</Code>
          <h3 className="font-display text-lg font-bold">Add a vendor, an item, and a runner</h3>
          <Code>{`curl -s ${base}/partner/events/$EVENT_ID/vendors -H "Authorization: Bearer $LAYOVR_KEY" \\
  -H "Content-Type: application/json" -d '{ "name": "Mama Put", "category": "Rice & mains" }'
curl -s ${base}/partner/events/$EVENT_ID/vendors/$VENDOR_ID/items -H "Authorization: Bearer $LAYOVR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "Jollof & chicken", "priceKobo": 450000, "category": "Mains", "kind": "goods", "inStock": true, "fulfilment": "deliver" }'
curl -s ${base}/partner/events/$EVENT_ID/staff -H "Authorization: Bearer $LAYOVR_KEY" \\
  -H "Content-Type: application/json" -d '{ "name": "Kunle", "role": "runner", "phone": "08012345678" }'
# → { "member": {...}, "pin": "482913" }  (shown once; they sign in at /staff with the event code + PIN)`}</Code>
          <p className="text-sm">
            Venue templates: <code>GET {base}/venue-templates</code>. Plan format guide: <code>docs/PLAN-STANDARD.md</code> in the repository.
          </p>
        </section>

        <section id="reference" className="scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-3xl font-extrabold">API reference</h2>
            <div className="flex gap-2">
              <a className="btn btn-sm bg-card" href="/api/docs" target="_blank" rel="noreferrer">
                Open full screen
              </a>
              <a className="btn btn-sm bg-card" href="/api/openapi.json" target="_blank" rel="noreferrer">
                OpenAPI JSON
              </a>
            </div>
          </div>
          <iframe src="/api/docs" title="Layovr API reference" className="card-pop mt-4 h-[80vh] w-full bg-white" loading="lazy" />
        </section>
      </Section>
    </>
  );
}
