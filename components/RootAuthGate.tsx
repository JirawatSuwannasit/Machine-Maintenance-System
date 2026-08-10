"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  AccessProvider,
  type AppAccess,
  type AppRole,
  type AppSection,
} from "@/components/AccessContext";
import Link from "next/link";

const ROLES = new Set<AppRole>(["admin", "user"]);
const SECTIONS = new Set<AppSection>(["REL", "GP", "FA", "CAL"]);

export default function RootAuthGate({
  children,
  accountOnly = false,
}: {
  children: React.ReactNode;
  accountOnly?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "pending" }
    | { status: "allowed"; access: AppAccess }
  >({ status: "loading" });

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;

      if (data.session) {
        const { data: accessRow } = await supabase
          .from("user_access")
          .select("role, section")
          .eq("user_id", data.session.user.id)
          .maybeSingle();
        if (!active) return;

        const role = accessRow?.role;
        const section = accessRow?.section;
        if (
          role === "admin" &&
          section === null &&
          ROLES.has(role)
        ) {
          setState({ status: "allowed", access: { role, section: null } });
        } else if (
          role === "user" &&
          typeof section === "string" &&
          SECTIONS.has(section as AppSection)
        ) {
          setState({
            status: "allowed",
            access: { role, section: section as AppSection },
          });
        } else {
          setState({ status: "pending" });
        }
        return;
      }

      router.replace("/login");
      router.refresh();
    });

    return () => {
      active = false;
    };
  }, [router]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-4">
        <p role="status" className="text-sm text-primary/70">
          กำลังตรวจสอบสิทธิ์...
        </p>
      </div>
    );
  }

  if (state.status === "pending") {
    if (accountOnly) return <>{children}</>;
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-4">
        <section className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-primary">
            ยังไม่ได้กำหนดสิทธิ์การใช้งาน
          </h1>
          <p className="mt-3 text-sm leading-6 text-primary/70">
            กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสิทธิ์และส่วนงาน
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link
              href="/change-password"
              className="flex min-h-[44px] items-center justify-center rounded-md border border-primary/20 px-4 text-sm font-medium text-primary"
            >
              เปลี่ยนรหัสผ่าน
            </Link>
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace("/login");
                router.refresh();
              }}
              className="min-h-[44px] rounded-md bg-primary px-4 text-sm font-medium text-white"
            >
              ออกจากระบบ
            </button>
          </div>
        </section>
      </div>
    );
  }

  return <AccessProvider access={state.access}>{children}</AccessProvider>;
}
