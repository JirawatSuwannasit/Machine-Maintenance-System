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

### แม่แบบอีเมลเชิญที่จำเป็นสำหรับ SSR

ลิงก์ `{{ .ConfirmationURL }}` เริ่มต้นยืนยันคำเชิญที่ Supabase แล้วส่งต่อไป Site URL แต่ session อาจอยู่ใน URL fragment ซึ่ง middleware ฝั่งเซิร์ฟเวอร์อ่านไม่ได้ จึงส่งผู้ใช้ที่ยังไม่มี session cookie ไป `/login` ก่อนที่แอปฝั่งเบราว์เซอร์จะทำงาน สำหรับสถาปัตยกรรม `@supabase/ssr` นี้ ต้องส่ง `TokenHash` ไปให้ route ฝั่งเซิร์ฟเวอร์ตรวจสอบและเขียน session cookie

1. ไปที่ **Authentication → Email Templates → Invite user**
2. ตั้ง Subject เช่น `คำเชิญเข้าใช้ระบบซ่อมบำรุงเครื่องจักร`
3. แทนที่ Message body ด้วยแม่แบบนี้ แล้วกด **Save**:

```html
<h2>คุณได้รับคำเชิญเข้าใช้ระบบซ่อมบำรุงเครื่องจักร</h2>
<p>กดปุ่มด้านล่างเพื่อยืนยันคำเชิญและตั้งรหัสผ่านของคุณ</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">
    ยืนยันคำเชิญและตั้งรหัสผ่าน
  </a>
</p>
```

ห้ามเปลี่ยน `type=invite` และห้ามใช้ `{{ .Token }}` แทน `{{ .TokenHash }}` route `/auth/confirm` จะเรียก `verifyOtp()` เพื่อสร้าง session cookie แล้วส่งผู้ใช้ไป `/update-password` โดยอัตโนมัติ ต้องตั้ง Site URL ให้เป็น production origin ที่ถูกต้องก่อนส่งคำเชิญ สำหรับการทดสอบ Preview ให้เปลี่ยน Site URL ชั่วคราวเป็น Preview origin ที่อนุญาต หรือส่งคำเชิญทดสอบจาก environment แยก แล้วเปลี่ยนกลับก่อนใช้งาน production

### จัดการสิทธิ์ผู้ใช้

- เชิญผู้ใช้: หลังบันทึกแม่แบบด้านบน ไปที่ **Authentication → Users → Invite user** ระบุอีเมลที่ได้รับอนุญาต แล้วให้ผู้ใช้เปิดอีเมล route `/auth/confirm` จะยืนยัน token และส่งไปตั้งรหัสผ่านที่ `/update-password`
- ยกเลิกสิทธิ์: ไปที่ **Authentication → Users** เลือกผู้ใช้ แล้ว **Ban user** หรือ **Delete user** ตามนโยบายองค์กร การลบผู้ใช้เป็นการดำเนินการถาวร
- ห้ามใส่ service-role key ในตัวแปร `NEXT_PUBLIC_*` หรือโค้ดฝั่งเบราว์เซอร์
