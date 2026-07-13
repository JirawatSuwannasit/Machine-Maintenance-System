"use client";

import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";

// Hides the sidebar/bottom-nav (and its layout offset on <main>) on /login,
// without touching the route structure of any other page. A route group
// would need to move every existing page under app/ into a new folder;
// this achieves the same isolation with a single new client component.
export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
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
