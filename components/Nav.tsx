"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutGrid,
  AlertTriangle,
  CalendarCheck,
  Package,
  BarChart3,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { label: "หน้าแรก", href: "/", icon: LayoutGrid },
  { label: "แจ้งเสีย", href: "/breakdowns", icon: AlertTriangle },
  { label: "งาน PM", href: "/pm", icon: CalendarCheck },
  { label: "อะไหล่", href: "/parts", icon: Package },
  { label: "รายงาน", href: "/reports", icon: BarChart3 },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (isMounted) {
        setUserEmail(data.user?.email ?? null);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Mobile top bar: current user + logout. Kept separate from the
          bottom nav so the bottom nav stays exactly 5 items. */}
      <div className="fixed inset-x-0 top-0 z-50 flex h-12 items-center justify-between gap-2 bg-primary px-4 text-white md:hidden">
        <span className="min-w-0 flex-1 truncate text-sm">{userEmail}</span>
        <button
          type="button"
          onClick={handleLogout}
          className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-white/90 hover:bg-white/10"
        >
          <LogOut size={16} aria-hidden="true" />
          <span>ออกจากระบบ</span>
        </button>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:flex md:w-60 md:flex-col bg-primary text-white">
        <div className="px-4 py-5 text-lg font-bold border-b border-white/10">
          ระบบซ่อมบำรุงเครื่องจักร
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <ul className="flex flex-col gap-1 px-2">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-accent text-white"
                        : "text-white/80 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-white/10 p-3">
          <p className="truncate text-xs text-white/70">{userEmail}</p>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 text-sm text-white/80 hover:bg-white/10 hover:text-white"
          >
            <LogOut size={18} aria-hidden="true" />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </aside>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-50 bg-primary text-white border-t border-white/10">
        <ul className="flex items-stretch justify-between">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className={`flex flex-col items-center justify-center gap-1 min-h-[44px] py-1.5 text-[11px] ${
                    active ? "text-white" : "text-white/70"
                  }`}
                >
                  <Icon
                    size={22}
                    aria-hidden="true"
                    className={active ? "text-accent" : ""}
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
