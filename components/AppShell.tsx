"use client";

import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";
import RootAuthGate from "@/components/RootAuthGate";
import AccessRouteGuard from "@/components/AccessRouteGuard";

// Hides authenticated navigation on the public login screen.
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

  if (pathname === "/change-password") {
    return <RootAuthGate accountOnly>{children}</RootAuthGate>;
  }

  return (
    <RootAuthGate>
      <Nav />
      <main className="pt-12 pb-[68px] md:pb-0 md:pl-60 md:pt-0">
        <AccessRouteGuard>{children}</AccessRouteGuard>
      </main>
    </RootAuthGate>
  );
}
