/// <reference types="vite/client" />
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { SiteFooter, SiteHeader, StaffHeader } from "@/components/SiteChrome";
import { EmptyCard, Section } from "@/components/ui-bits";
import { useConnection } from "@/lib/store";
import appCss from "../styles.css?url";

const STAFF_PREFIXES = ["/ops", "/runner", "/admin", "/staff"];
/** Pages that render without live data (everything else waits for the first snapshot). */
const STATIC_PATHS = ["/", "/how-it-works"];

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Layovr · Good stuff, delivered to where you are" },
      {
        name: "description",
        content:
          "Scan a Layovr code, order from vendors nearby and we'll bring it to your spot.",
      },
      { name: "theme-color", content: "#fbf7ef" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=DM+Sans:wght@400;500;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            className:
              "!border-2 !border-ink !rounded-2xl !shadow-pop !font-sans",
          }}
        />
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isStaff = STAFF_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  if (isStaff) {
    return (
      <>
        <StaffHeader />
        <main className="min-h-[calc(100vh-56px)] bg-muted/40">
          <DataGate>
            <Outlet />
          </DataGate>
        </main>
      </>
    );
  }
  return (
    <>
      <SiteHeader />
      <main>
        {STATIC_PATHS.includes(path) ? (
          <Outlet />
        ) : (
          <DataGate>
            <Outlet />
          </DataGate>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

/** Waits for the first snapshot from the API, and says so if it can't be reached. */
function DataGate({ children }: { children: ReactNode }) {
  const connection = useConnection();
  if (connection === "ready") return <>{children}</>;
  return (
    <Section>
      {connection === "loading" ? (
        <p className="text-center text-lg">Loading…</p>
      ) : (
        <EmptyCard emoji="📡" title="Can't reach Layovr right now">
          <p>Check your data connection. We'll keep trying.</p>
        </EmptyCard>
      )}
    </Section>
  );
}

function NotFound() {
  return (
    <Section>
      <EmptyCard
        emoji="🧭"
        title="We couldn't find that page"
        action={
          <Link to="/" className="btn bg-coral">
            Back home
          </Link>
        }
      >
        <p>The link may be old, or the code may have a typo.</p>
      </EmptyCard>
    </Section>
  );
}
