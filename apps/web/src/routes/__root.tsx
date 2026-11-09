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
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { BackButton } from "@/components/BackButton";
import { DashboardHeader } from "@/components/DashboardChrome";
import { queryClient } from "@/lib/partnerApi";
import { SiteFooter, SiteHeader, StaffHeader } from "@/components/SiteChrome";
import { EmptyCard, Section } from "@/components/ui-bits";
import { useConnection } from "@/lib/store";
import appCss from "../styles.css?url";

const STAFF_PREFIXES = ["/ops", "/runner", "/admin", "/staff"];
/** Pages that render without live data (everything else waits for the first snapshot). */
const STATIC_PATHS = ["/", "/how-it-works", "/developers"];
/** Pages with their own data (partner dashboard, vendor invites): no live snapshot needed. */
const OWN_DATA_PREFIXES = ["/dashboard", "/join"];

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
  return (
    <QueryClientProvider client={queryClient}>
      <Layout />
    </QueryClientProvider>
  );
}

function Layout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const ownData = OWN_DATA_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    return (
      <>
        <DashboardHeader />
        <main className="min-h-[calc(100vh-56px)] bg-muted/40">
          <div className="mx-auto max-w-7xl px-4 pt-4">
            <BackButton path={path} />
          </div>
          <Outlet />
        </main>
      </>
    );
  }
  const isStaff = STAFF_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  if (isStaff) {
    return (
      <>
        <StaffHeader />
        <main className="min-h-[calc(100vh-56px)] bg-muted/40">
          <div className="mx-auto max-w-7xl px-4 pt-4">
            <BackButton path={path} />
          </div>
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
        {path !== "/" && (
          <div className="mx-auto max-w-7xl px-4 pt-4">
            <BackButton path={path} />
          </div>
        )}
        {STATIC_PATHS.includes(path) || ownData ? (
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
