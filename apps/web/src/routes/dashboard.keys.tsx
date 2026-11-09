import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RequirePartner } from "@/components/DashboardChrome";
import { McpConnect } from "@/components/McpConnect";
import { Field } from "@/components/ui-bits";
import { papi, refresh, useKeys } from "@/lib/partnerApi";

export const Route = createFileRoute("/dashboard/keys")({
  head: () => ({ meta: [{ title: "API keys & MCP · Layovr partners" }] }),
  component: () => <RequirePartner>{() => <Keys />}</RequirePartner>,
});

function Keys() {
  const keys = useKeys();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"write" | "read">("write");
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);

  const create = async (keyName = name.trim() || "AI assistant") => {
    try {
      const k = await papi<{ name: string; key: string }>("/partner/keys", { body: { name: keyName, scope } });
      setFresh(k);
      setName("");
      await refresh(["keys"]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[1fr_1.3fr]">
      <div className="grid h-fit gap-6">
        <section className="card-pop grid gap-3 bg-card p-6">
          <h1 className="text-2xl font-extrabold">API keys</h1>
          <p className="text-sm">
            For connecting your own event app, ticketing platform or AI assistant. A key acts as your organisation: it can see and change all your events.
          </p>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <Field label="Name it after where you'll use it">
              <input className="field py-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="TIX integration, Claude…" />
            </Field>
            <Field label="Access">
              <select className="field py-1.5" value={scope} onChange={(e) => setScope(e.target.value as "write" | "read")}>
                <option value="write">Read & write</option>
                <option value="read">Read only</option>
              </select>
            </Field>
            <button type="submit" className="btn btn-sm bg-coral">
              Create key
            </button>
          </form>
          {fresh && (
            <div className="rounded-2xl border-2 border-ink bg-mint/60 p-4" role="status">
              <p className="font-bold">“{fresh.name}” created. Copy it now; it won't be shown again.</p>
              <code className="mt-2 block break-all rounded-lg border-2 border-ink bg-card p-2 font-mono text-sm">{fresh.key}</code>
              <button type="button" className="btn btn-sm mt-2 bg-card" onClick={() => void navigator.clipboard?.writeText(fresh.key).then(() => toast.success("Copied"))}>
                Copy key
              </button>
            </div>
          )}
          <ul className="divide-y-2 divide-ink/10">
            {keys.data?.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <b>{k.name}</b> <code className="text-xs">{k.prefix}…</code> · {k.scope === "read" ? "read only" : "read & write"}
                  <span className="block text-xs text-muted-foreground">
                    {k.revoked ? "Revoked" : k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleString("en-NG")}` : "Never used"}
                  </span>
                </span>
                {!k.revoked && (
                  <button
                    type="button"
                    className="text-xs font-bold text-destructive underline"
                    onClick={async () => {
                      if (!window.confirm(`Revoke ${k.name}? Anything using it stops working.`)) return;
                      await papi(`/partner/keys/${k.id}`, { method: "DELETE" }).catch((e) => toast.error(String(e)));
                      await refresh(["keys"]);
                    }}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="card-pop h-fit bg-sun p-6">
        <h2 className="text-2xl font-extrabold">Connect an AI assistant or your platform</h2>
        <p className="mt-1 text-sm">
          Layovr speaks the Model Context Protocol, so Claude, Cursor, VS Code or your own event manager can create events, edit plans, add vendors and staff, and watch orders, in plain language.
        </p>
        <div className="mt-4">
          <McpConnect apiKey={fresh?.key} onCreateKey={() => void create("AI assistant")} />
        </div>
      </section>
    </div>
  );
}
