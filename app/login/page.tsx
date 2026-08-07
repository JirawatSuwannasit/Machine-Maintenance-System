"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function mapErrorMessage(message: string): string {
  if (message === "Invalid login credentials") {
    return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  }
  if (message === "Email not confirmed") {
    return "อีเมลนี้ยังไม่ได้ยืนยัน กรุณาติดต่อผู้ดูแลระบบ";
  }
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const forgotPasswordDialogRef = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMessage(mapErrorMessage(error.message));
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-center text-2xl font-bold text-primary">
          ระบบซ่อมบำรุงเครื่องจักร
        </h1>
        <p className="mt-1 text-center text-sm text-primary/70">เข้าสู่ระบบ</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-primary"
            >
              อีเมล
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="mt-2 text-right">
              <button
                type="button"
                onClick={() => forgotPasswordDialogRef.current?.showModal()}
                className="min-h-[44px] rounded-md px-2 text-sm font-medium text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent"
              >
                ลืมรหัสผ่าน?
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-primary"
            >
              รหัสผ่าน
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 block w-full min-h-[44px] rounded-md border border-primary/20 px-3 py-2 text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {errorMessage && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-primary/60">
          ผู้ดูแลระบบเป็นผู้สร้างบัญชีให้
        </p>
      </div>

      <dialog
        ref={forgotPasswordDialogRef}
        aria-labelledby="forgot-password-title"
        aria-describedby="forgot-password-description"
        className="w-[calc(100%-2rem)] max-w-sm rounded-lg bg-white p-0 text-primary shadow-lg backdrop:bg-primary/40"
      >
        <div className="p-6 text-center">
          <h2 id="forgot-password-title" className="text-xl font-bold">
            ลืมรหัสผ่าน?
          </h2>
          <p id="forgot-password-description" className="mt-3 text-sm text-primary/70">
            กรุณาติดต่อผู้ดูแลระบบเพื่อขอเปลี่ยนรหัสผ่าน
          </p>
          <form method="dialog" className="mt-6">
            <button
              type="submit"
              autoFocus
              className="min-h-[44px] w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
            >
              ปิด
            </button>
          </form>
        </div>
      </dialog>
    </div>
  );
}
