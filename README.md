# Machine-Maintenance-System

## การยืนยันตัวตนแบบเฉพาะผู้ได้รับเชิญ

ระบบไม่มีหน้าสมัครสมาชิก ผู้ดูแลระบบต้องจัดการผู้ใช้ผ่าน Supabase Dashboard เท่านั้น รหัสผ่านอยู่ใน Supabase Auth และไม่ถูกเก็บในตารางของแอปพลิเคชัน

### การเปลี่ยนแปลงในโค้ด

- ผู้ใช้เดิมเข้าสู่ระบบด้วยอีเมลและรหัสผ่านได้เหมือนเดิม
- หน้า `/forgot-password`, `/update-password` และ callback `/auth/confirm` รองรับการกู้รหัสผ่านและรับคำเชิญ
- ผู้ใช้ที่เข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านได้ที่ `/change-password`

### การตั้งค่า Supabase Dashboard ด้วยตนเอง

1. ที่ **Authentication → Providers → Email** เปิดใช้งาน Email/Password และปิด **Allow new users to sign up** เพื่อไม่ให้บุคคลทั่วไปสมัครเอง
2. ที่ **Authentication → URL Configuration** ตั้ง **Site URL** เป็น URL production ที่ใช้จริง เช่น `https://your-production-domain.example`
3. เพิ่ม **Redirect URLs** สำหรับ `https://your-production-domain.example/update-password`, `https://your-production-domain.example/auth/confirm` และ `https://your-production-domain.example/auth/callback` รวมทั้ง URL เดียวกันบน Vercel Preview ที่อนุญาต เช่น `https://*-your-vercel-project.vercel.app/**` โดยใช้ wildcard ตามรูปแบบที่ Supabase รองรับ URL รีเซ็ตรหัสผ่านถูกสร้างจาก origin ของ deployment ปัจจุบันและไม่มีโดเมน production ที่ hard-code ในโค้ด
4. ก่อนใช้อีเมลเชิญหรือรีเซ็ตรหัสผ่านใน production ให้ตั้ง **Project Settings → Authentication → SMTP Settings** เป็น Custom SMTP ขององค์กร เพื่อความน่าเชื่อถือและข้อจำกัดการส่งที่เหมาะสม

### อีเมลเชิญเริ่มต้นของ Supabase

ไม่ต้องแก้ Subject หรือ Message body ของ **Invite user** และใช้ลิงก์ `{{ .ConfirmationURL }}` เริ่มต้นได้ตามเดิม ผู้ดูแลส่งคำเชิญที่ **Authentication → Users → Add user → Send invitation**

ลิงก์เริ่มต้นจะเปิด endpoint ยืนยันของ Supabase ก่อน redirect ไป **Site URL** พร้อม implicit-flow parameters ใน URL fragment รูปแบบนี้:

```text
https://your-production-domain.example/#access_token=...&refresh_token=...&type=invite&...
```

URL fragment ไม่ถูกส่งไป middleware ฝั่งเซิร์ฟเวอร์ แอปจึงอนุญาตให้ Site URL `/` โหลด bootstrap ขนาดเล็กซึ่งย้าย invite fragment ไป `/update-password` ก่อน render หน้าระบบ จากนั้น browser client ของ `@supabase/ssr` อ่าน fragment, ตรวจสอบ session และเก็บ session ใน cookie ผู้ใช้จึงตั้งรหัสผ่านของตนเองได้ ผู้เข้าชม `/` ที่ไม่มี invite session จะถูก client auth gate ส่งไป `/login` โดยไม่ render หรือเรียกข้อมูลระบบ และทุก route งานอื่นยังถูก middleware ป้องกันเหมือนเดิม

### จัดการสิทธิ์ผู้ใช้

- เชิญผู้ใช้: ไปที่ **Authentication → Users → Add user → Send invitation** ระบุอีเมลที่ได้รับอนุญาต ผู้ใช้กดลิงก์ **Accept invitation** เริ่มต้นแล้วระบบจะส่งไปตั้งรหัสผ่านที่ `/update-password` โดยอัตโนมัติ
- ยกเลิกสิทธิ์: ไปที่ **Authentication → Users** เลือกผู้ใช้ แล้ว **Ban user** หรือ **Delete user** ตามนโยบายองค์กร การลบผู้ใช้เป็นการดำเนินการถาวร
- ห้ามใส่ service-role key ในตัวแปร `NEXT_PUBLIC_*` หรือโค้ดฝั่งเบราว์เซอร์
