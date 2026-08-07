"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import PasswordFields from "@/components/PasswordFields";

const minimumPasswordLength = 8;

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function establishSession() {
      const code = new URL(window.location.href).searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        window.history.replaceState({}, "", "/update-password");
        if (error && active) {
          setErrorMessage("ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่");
        }
      }

      const { data } = await supabase.auth.getSession();
      if (active) {
        setHasSession(Boolean(data.session));
        setCheckingSession(false);
      }
    }

    establishSession();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    if (newPassword.length < minimumPasswordLength) {
      setErrorMessage(`รหัสผ่านต้องมีอย่างน้อย ${minimumPasswordLength} ตัวอักษร`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) {
      if (error.status === 401 || error.status === 403) {
        router.replace("/login");
        router.refresh();
        return;
      }
      setErrorMessage("ไม่สามารถตั้งรหัสผ่านได้ กรุณาลองใหม่อีกครั้ง");
      return;
    }
    setSuccess(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-center text-2xl font-bold">ตั้งรหัสผ่านใหม่</h1>
        {checkingSession ? (
          <p role="status" className="mt-6 text-center text-sm text-primary/70">กำลังตรวจสอบลิงก์...</p>
        ) : success ? (
          <div className="mt-6 space-y-4 text-center">
            <div role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">ตั้งรหัสผ่านใหม่สำเร็จ</div>
            <Link href="/" className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">เข้าสู่ระบบงาน</Link>
          </div>
        ) : !hasSession ? (
          <div className="mt-6 space-y-4 text-center">
            <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {errorMessage ?? "ไม่พบสิทธิ์สำหรับตั้งรหัสผ่าน กรุณาเปิดลิงก์จากอีเมลหรือขอลิงก์ใหม่"}
            </div>
            <Link href="/forgot-password" className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">ขอลิงก์ใหม่</Link>
            <Link href="/login" className="block min-h-[44px] py-3 text-sm font-medium text-accent hover:underline">กลับไปหน้าเข้าสู่ระบบ</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <PasswordFields newPassword={newPassword} confirmPassword={confirmPassword} onNewPassword={setNewPassword} onConfirmPassword={setConfirmPassword} />
            {errorMessage && <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMessage}</div>}
            <button type="submit" disabled={loading} className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-70">{loading ? "กำลังบันทึก..." : "ตั้งรหัสผ่านใหม่"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
