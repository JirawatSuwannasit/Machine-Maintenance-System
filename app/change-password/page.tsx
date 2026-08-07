"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import PasswordFields from "@/components/PasswordFields";
import { supabase } from "@/lib/supabase";

export default function ChangePasswordPage() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    if (newPassword.length < 8) {
      setErrorMessage("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
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
      setErrorMessage("ไม่สามารถเปลี่ยนรหัสผ่านได้ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง");
      return;
    }
    setSuccess(true);
    setNewPassword("");
    setConfirmPassword("");
  }

  return <div className="mx-auto w-full max-w-lg p-4 py-8 md:p-8">
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold">เปลี่ยนรหัสผ่าน</h1>
      {success ? <div className="mt-6 space-y-4"><div role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">เปลี่ยนรหัสผ่านสำเร็จ</div><Link href="/" className="flex min-h-[44px] items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">กลับไปหน้าแรก</Link></div> : <form onSubmit={handleSubmit} className="mt-6 space-y-4"><PasswordFields newPassword={newPassword} confirmPassword={confirmPassword} onNewPassword={setNewPassword} onConfirmPassword={setConfirmPassword} />{errorMessage && <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMessage}</div>}<button type="submit" disabled={loading} className="flex min-h-[44px] w-full items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-70">{loading ? "กำลังบันทึก..." : "เปลี่ยนรหัสผ่าน"}</button><Link href="/" className="block min-h-[44px] py-3 text-center text-sm font-medium text-accent hover:underline">ยกเลิกและกลับหน้าแรก</Link></form>}
    </div>
  </div>;
}
