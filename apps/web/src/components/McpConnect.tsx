import { useState } from "react";
import { toast } from "sonner";
import { useMcpInfo } from "@/lib/partnerApi";
import { cn, useOrigin } from "@/lib/utils";

/**
 * "Connect via MCP": copy-paste set-up for AI assistants and event platforms.
 * With `apiKey` the snippets are ready to paste; without it they show a placeholder.
 */

const CLIENTS = ["Claude Code", "Claude Desktop", "Cursor", "VS Code", "Any MCP client"] as const;
type Client = (typeof CLIENTS)[number];

function snippet(client: Client, url: string, key: string): { where: string; code: string } {
  const auth = `Bearer ${key}`;
  const mcpServers = JSON.stringify({ mcpServers: { layovr: { type: "http", url, headers: { Authorization: auth } } } }, null, 2);
  switch (client) {
    case "Claude Code":
      return { where: "Run in your terminal:", code: `claude mcp add --transport http layovr ${url} \\\n  --header "Authorization: ${auth}"` };
    case "Claude Desktop":
      return {
        where: "Claude Desktop doesn't send custom headers to remote servers directly, so bridge it with mcp-remote. Settings → Developer → Edit Config (claude_desktop_config.json):",
        code: JSON.stringify(
          { mcpServers: { layovr: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization:${auth}`] } } },
          null,
          2,
        ),
      };
    case "Cursor":
      return { where: "Add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project):", code: mcpServers.replace('"type": "http",\n      ', "") };
    case "VS Code":
      return {
        where: "Add to .vscode/mcp.json in your workspace:",
        code: JSON.stringify({ servers: { layovr: { type: "http", url, headers: { Authorization: auth } } } }, null, 2),
      };
    case "Any MCP client":
      return {
        where: "Streamable HTTP transport. Point your platform's MCP client (or agent framework) at the URL with this header. Check it with curl:",
        code: `URL: ${url}\nHeader: Authorization: ${auth}\n\ncurl -s ${url} \\\n  -H "Authorization: ${auth}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
      };
  }
}

export function McpConnect({ apiKey, onCreateKey }: { apiKey?: string | undefined; onCreateKey?: (() => void) | undefined }) {
  const info = useMcpInfo();
  const origin = useOrigin();
  const [client, setClient] = useState<Client>("Claude Code");
  const url = info.data?.url ?? `${origin}/api/mcp`;
  const s = snippet(client, url, apiKey ?? "lvk_YOUR_API_KEY");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Server URL</span>
        <code className="rounded-lg border-2 border-ink bg-card px-2 py-1 font-mono text-sm">{url}</code>
        <span className="chip bg-mint text-[11px]">Streamable HTTP</span>
      </div>
      {!apiKey && (
        <p className="rounded-xl border-2 border-dashed border-ink/40 p-3 text-sm">
          You need an API key.{" "}
          {onCreateKey ? (
            <button type="button" className="font-bold underline" onClick={onCreateKey}>
              Create one now
            </button>
          ) : (
            <a className="font-bold underline" href="/dashboard/keys">
              Create one in the dashboard
            </a>
          )}{" "}
          and the set-up below fills it in.
        </p>
      )}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="MCP client">
        {CLIENTS.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={client === c}
            onClick={() => setClient(c)}
            className={cn("rounded-full border-2 border-ink px-3 py-1 text-sm font-bold", client === c ? "bg-sun" : "bg-card")}
          >
            {c}
          </button>
        ))}
      </div>
      <div>
        <p className="text-sm">{s.where}</p>
        <div className="relative mt-2">
          <pre className="overflow-x-auto rounded-2xl border-2 border-ink bg-ink p-4 text-xs leading-relaxed text-ink-foreground">
            <code>{s.code}</code>
          </pre>
          <button
            type="button"
            className="btn btn-sm absolute right-2 top-2 bg-sun"
            onClick={() => void navigator.clipboard?.writeText(s.code).then(() => toast.success("Copied"))}
          >
            Copy
          </button>
        </div>
        {apiKey && <p className="mt-1 text-xs text-muted-foreground">Includes your secret key. Don't paste it anywhere public.</p>}
      </div>
      {info.data && (
        <details className="rounded-2xl border-2 border-ink bg-card p-4">
          <summary className="cursor-pointer font-bold">
            {info.data.tools.length} tools · resources {info.data.resources.join(", ")} · prompt “{info.data.prompts.join(", ")}”
          </summary>
          <p className="mt-2 text-sm">
            Tools marked ✎ change your data. They return a preview first; the assistant applies them only after you agree (it calls again with
            <code className="mx-1">confirm: true</code>). Every call is logged.
          </p>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {info.data.tools.map((t) => (
              <li key={t.name} className="rounded-xl border-2 border-ink/20 p-2 text-sm">
                <code className="font-bold">{t.name}</code> {t.write && <span title="Changes data">✎</span>}
                <span className="block text-xs">{t.description}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
