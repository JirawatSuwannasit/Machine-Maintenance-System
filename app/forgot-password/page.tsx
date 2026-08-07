"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

const neutralMessage =
  "หากอีเมลนี้มีบัญชีอยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่แล้ว";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setErrorMessage(null);

    const redirectTo = `${window.location.origin}/update-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    setLoading(false);
    if (error) {
      setErrorMessage(
        error.status === 429
          ? "ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่"
          : "ไม่สามารถส่งลิงก์ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง"
      );
      return;
    }
    setMessage(neutralMessage);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-center text-2xl font-bold text-primary">
          ลืมรหัสผ่าน
        </h1>
        <p className="mt-2 text-center text-sm text-primary/70">
          กรอกอีเมลเพื่อรับลิงก์ตั้งรหัสผ่านใหม่
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              อีเมล
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-md border border-primary/20 px-3 py-2 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          {message && (
            <div role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">
              {message}
            </div>
          )}
          {errorMessage && (
            <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {errorMessage}
            </div>
          )}
          <button type="submit" disabled={loading} className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-70">
            {loading ? "กำลังส่ง..." : "ส่งลิงก์ตั้งรหัสผ่านใหม่"}
          </button>
        </form>
        <Link href="/login" className="mt-4 block min-h-[44px] py-3 text-center text-sm font-medium text-accent hover:underline">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </div>
  );
}
