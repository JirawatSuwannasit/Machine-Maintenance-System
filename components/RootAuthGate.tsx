"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function RootAuthGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;

      if (data.session) {
        setAuthenticated(true);
        return;
      }

      router.replace("/login");
      router.refresh();
    });

    return () => {
      active = false;
    };
  }, [router]);

  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-4">
        <p role="status" className="text-sm text-primary/70">
          กำลังตรวจสอบสิทธิ์...
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
