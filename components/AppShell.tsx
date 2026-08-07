"use client";

import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";
import RootAuthGate from "@/components/RootAuthGate";

// Hides authenticated navigation on public authentication screens.
// without touching the route structure of any other page. A route group
// would need to move every existing page under app/ into a new folder;
// this achieves the same isolation with a single new client component.
export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/update-password" ||
    pathname.startsWith("/auth/")
  ) {
    return <>{children}</>;
  }

  // Supabase's default invite email returns implicit-flow credentials in the
  // URL fragment at the Site URL. Middleware cannot read fragments, so `/`
  // reaches this client gate. The inline bootstrap in app/layout.tsx moves an
  // invite fragment to /update-password; all other anonymous root visits are
  // redirected to /login here before protected UI is mounted.
  if (pathname === "/") {
    return (
      <RootAuthGate>
        <Nav />
        <main className="pt-12 pb-[68px] md:pb-0 md:pl-60 md:pt-0">
          {children}
        </main>
      </RootAuthGate>
    );
  }

  return (
    <>
      <Nav />
      <main className="pt-12 pb-[68px] md:pb-0 md:pl-60 md:pt-0">
        {children}
      </main>
    </>
  );
}
