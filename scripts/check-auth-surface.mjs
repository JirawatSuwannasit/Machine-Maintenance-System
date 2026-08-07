import { existsSync, readFileSync } from "node:fs";

const removedRoutes = [
  "app/signup/page.tsx",
  "app/forgot-password/page.tsx",
  "app/update-password/page.tsx",
  "app/auth/callback/route.ts",
  "app/auth/confirm/route.ts",
];

const forbiddenAuthPatterns = [
  "auth.signUp",
  "resetPasswordForEmail",
  "verifyOtp",
  "exchangeCodeForSession",
];

const sourceFiles = [
  "app/login/page.tsx",
  "app/change-password/page.tsx",
  "components/Nav.tsx",
  "lib/supabase.ts",
  "middleware.ts",
];

const redirectConfig = readFileSync("next.config.mjs", "utf8");
const cancelledRouteRedirects = [
  'source: "/forgot-password"',
  'source: "/update-password"',
  'source: "/auth/:path*"',
  'source: "/signup"',
];

const failures = [];
const loginSource = readFileSync("app/login/page.tsx", "utf8");

if (loginSource.includes("ลืมรหัสผ่าน?") || loginSource.includes("/forgot-password")) {
  failures.push("หน้าเข้าสู่ระบบยังมีลิงก์ลืมรหัสผ่าน");
}

for (const route of removedRoutes) {
  if (existsSync(route)) {
    failures.push(`ยังพบเส้นทางที่ยกเลิกแล้ว: ${route}`);
  }
}

for (const redirect of cancelledRouteRedirects) {
  if (!redirectConfig.includes(redirect)) {
    failures.push(`ไม่พบ redirect สำหรับเส้นทางที่ยกเลิกแล้ว: ${redirect}`);
  }
}

for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  for (const pattern of forbiddenAuthPatterns) {
    if (source.includes(pattern)) {
      failures.push(`พบ ${pattern} ใน ${file}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("ตรวจสอบแล้ว: ไม่มีหน้าสมัครสมาชิกหรือลิงก์กู้รหัสผ่าน");
