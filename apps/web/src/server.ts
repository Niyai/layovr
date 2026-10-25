import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

/**
 * Server entry with a small SSR error wrapper: if rendering throws, the
 * visitor gets a friendly page instead of a blank 500.
 */
export default createServerEntry({
  async fetch(request) {
    try {
      return await handler.fetch(request);
    } catch (error) {
      console.error("[ssr]", error);
      return new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Layovr</title><body style="font-family:system-ui;background:#fbf7ef;color:#1d1b2b;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center;padding:24px"><div style="font-size:48px">🙈</div><h1>Something tripped up</h1><p>Please refresh in a moment.</p></div>`,
        {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    }
  },
});
