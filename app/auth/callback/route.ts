import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const type =
    rawType === "invite" || rawType === "recovery"
      ? (rawType as EmailOtpType)
      : null;
  const destination = new URL("/update-password", url.origin);
  const supabase = createSupabaseServerClient();

  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing authentication parameters") };

  if (result.error) {
    destination.searchParams.set("error", "invalid_link");
  }
  return NextResponse.redirect(destination);
}
