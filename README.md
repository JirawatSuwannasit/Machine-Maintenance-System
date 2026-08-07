# Machine-Maintenance-System

## การยืนยันตัวตนแบบเฉพาะผู้ได้รับเชิญ

ระบบไม่มีหน้าสมัครสมาชิก ผู้ดูแลระบบต้องจัดการผู้ใช้ผ่าน Supabase Dashboard เท่านั้น รหัสผ่านอยู่ใน Supabase Auth และไม่ถูกเก็บในตารางของแอปพลิเคชัน

### การเปลี่ยนแปลงในโค้ด

- ผู้ใช้เดิมเข้าสู่ระบบด้วยอีเมลและรหัสผ่านได้เหมือนเดิม
- หน้า `/forgot-password`, `/update-password` และ callback `/auth/callback` รองรับการกู้รหัสผ่านและรับคำเชิญ
- ผู้ใช้ที่เข้าสู่ระบบแล้วเปลี่ยนรหัสผ่านได้ที่ `/change-password`

### การตั้งค่า Supabase Dashboard ด้วยตนเอง

1. ที่ **Authentication → Providers → Email** เปิดใช้งาน Email/Password และปิด **Allow new users to sign up** เพื่อไม่ให้บุคคลทั่วไปสมัครเอง
2. ที่ **Authentication → URL Configuration** ตั้ง **Site URL** เป็น URL production ที่ใช้จริง เช่น `https://your-production-domain.example`
3. เพิ่ม **Redirect URLs** สำหรับ `https://your-production-domain.example/update-password` และ `https://your-production-domain.example/auth/callback` รวมทั้ง URL ของ Vercel Preview ที่อนุญาต เช่น `https://*-your-vercel-project.vercel.app/update-password` และ `https://*-your-vercel-project.vercel.app/auth/callback` โดยใช้ wildcard ตามรูปแบบที่ Supabase รองรับ URL ถูกสร้างจาก origin ของ deployment ปัจจุบันและไม่มีโดเมน production ที่ hard-code ในโค้ด
4. ก่อนใช้อีเมลเชิญหรือรีเซ็ตรหัสผ่านใน production ให้ตั้ง **Project Settings → Authentication → SMTP Settings** เป็น Custom SMTP ขององค์กร เพื่อความน่าเชื่อถือและข้อจำกัดการส่งที่เหมาะสม

### จัดการสิทธิ์ผู้ใช้

- เชิญผู้ใช้: ไปที่ **Authentication → Users → Invite user** ระบุอีเมลที่ได้รับอนุญาต แล้วให้ผู้ใช้เปิดอีเมลและตั้งรหัสผ่านด้วยตนเอง หากแก้แม่แบบอีเมลเชิญ ให้กำหนดปลายทางเป็น `/update-password` หรือ `/auth/callback` ที่ส่งต่อไปหน้านี้
- ยกเลิกสิทธิ์: ไปที่ **Authentication → Users** เลือกผู้ใช้ แล้ว **Ban user** หรือ **Delete user** ตามนโยบายองค์กร การลบผู้ใช้เป็นการดำเนินการถาวร
- ห้ามใส่ service-role key ในตัวแปร `NEXT_PUBLIC_*` หรือโค้ดฝั่งเบราว์เซอร์
