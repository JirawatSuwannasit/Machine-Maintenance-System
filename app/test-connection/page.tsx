"use client";

// Temporary diagnostic page for MMS-002. Not linked from the nav.
// Delete this page in MMS-023 once the real app pages are in place.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type ConnectionState =
  | { status: "loading" }
  | { status: "success" }
  | { status: "table-missing" }
  | { status: "error"; message: string; code: string };

function truncateEnvValue(value: string | undefined): string {
  if (!value) {
    return "(ไม่พบค่า)";
  }
  return `${value.slice(0, 20)}...`;
}

export default function TestConnectionPage() {
  const [state, setState] = useState<ConnectionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function checkConnection() {
      const { error } = await supabase.from("machines").select("count");

      if (cancelled) {
        return;
      }

      if (!error) {
        setState({ status: "success" });
        return;
      }

      if (error.code === "42P01") {
        setState({ status: "table-missing" });
        return;
      }

      setState({
        status: "error",
        message: error.message,
        code: error.code ?? "(ไม่มีรหัส)",
      });
    }

    checkConnection();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">ทดสอบการเชื่อมต่อ Supabase</h1>

      <div className="mt-4">
        {state.status === "loading" && (
          <div className="rounded-md border border-primary/20 bg-white p-4 text-primary">
            กำลังตรวจสอบการเชื่อมต่อ...
          </div>
        )}

        {state.status === "success" && (
          <div className="rounded-md border border-green-300 bg-green-50 p-4 text-green-800">
            เชื่อมต่อ Supabase สำเร็จ
          </div>
        )}

        {state.status === "table-missing" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-800">
            เชื่อมต่อ Supabase สำเร็จ — ยังไม่มีตาราง machines (จะสร้างใน MMS-004)
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-red-800">
            <p>เกิดข้อผิดพลาดในการเชื่อมต่อ Supabase</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-red-100 p-2 font-mono text-xs text-red-900">
              {`message: ${state.message}\ncode: ${state.code}`}
            </pre>
          </div>
        )}
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-primary/70">
          ตัวแปรสภาพแวดล้อมที่ตรวจพบ
        </h2>
        <dl className="mt-2 space-y-1 text-xs">
          <div className="flex flex-col break-all sm:flex-row sm:gap-2">
            <dt className="font-mono font-semibold">
              NEXT_PUBLIC_SUPABASE_URL:
            </dt>
            <dd className="font-mono">
              {truncateEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL)}
            </dd>
          </div>
          <div className="flex flex-col break-all sm:flex-row sm:gap-2">
            <dt className="font-mono font-semibold">
              NEXT_PUBLIC_SUPABASE_ANON_KEY:
            </dt>
            <dd className="font-mono">
              {truncateEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
