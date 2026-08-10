"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccess } from "@/components/AccessContext";

const ADMIN_ONLY_ROUTES = [
  "/machines/new",
  "/pm/plans",
  "/parts/new",
];

function isAdminOnlyRoute(pathname: string): boolean {
  return (
    ADMIN_ONLY_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`)
    ) ||
    /^\/machines\/[^/]+\/edit$/.test(pathname) ||
    /^\/parts\/[^/]+\/edit$/.test(pathname)
  );
}

export default function AccessRouteGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const access = useAccess();

  if (isAdminOnlyRoute(pathname) && access.role !== "admin") {
    return (
      <div className="p-4">
        <section className="mx-auto mt-8 max-w-md rounded-lg border border-primary/10 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-primary">ไม่มีสิทธิ์ดำเนินการ</h1>
          <p className="mt-2 text-sm text-primary/70">
            รายการนี้สำหรับผู้ดูแลระบบเท่านั้น
          </p>
          <Link
            href="/"
            className="mt-6 flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-white"
          >
            กลับหน้าแรก
          </Link>
        </section>
      </div>
    );
  }

  return <>{children}</>;
}
