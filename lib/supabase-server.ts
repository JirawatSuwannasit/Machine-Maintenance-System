import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const rawSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!rawSupabaseUrl || !rawSupabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY are not set."
  );
}

// Re-bind with an explicit `string` type so the closure inside
// createSupabaseServerClient() below does not widen back to
// `string | undefined` (TypeScript does not carry control-flow
// narrowing of an outer const into a nested function body).
const supabaseUrl: string = rawSupabaseUrl;
const supabaseAnonKey: string = rawSupabaseAnonKey;

// Server-side Supabase client for use in Server Components and Route
// Handlers. Unlike lib/supabase.ts, this must be created per request (it
// binds to the current request's cookies via next/headers), so it is a
// factory function rather than a shared singleton.
export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component, where cookies cannot be
          // written. Safe to ignore because middleware.ts refreshes the
          // session on every request.
        }
      },
    },
  });
}
