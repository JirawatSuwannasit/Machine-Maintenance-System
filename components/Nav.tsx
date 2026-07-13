"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  AlertTriangle,
  CalendarCheck,
  Package,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

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

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:fixed md:inset-y-0 md:left-0 md:w-60 md:flex-col bg-primary text-white">
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
