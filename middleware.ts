import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const rawSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!rawSupabaseUrl || !rawSupabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY are not set."
  );
}

// Re-bind with an explicit `string` type so the closure inside
// middleware() below does not widen back to `string | undefined`
// (TypeScript does not carry control-flow narrowing of an outer const
// into a nested function body).
const supabaseUrl: string = rawSupabaseUrl;
const supabaseAnonKey: string = rawSupabaseAnonKey;

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Per-request Supabase client bound to this middleware invocation's own
  // request/response cookies. This is the ONE allowed exception to the
  // single-client rule in lib/supabase.ts -- the @supabase/ssr middleware
  // pattern requires a fresh client scoped to each request so it can read
  // the incoming session cookie and write a refreshed one onto the response.
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === "/login";
  const isPublicAuthRoute =
    isLoginPage ||
    // The default Supabase invite template redirects to the Site URL with
    // credentials in the URL fragment. Fragments never reach middleware; `/`
    // must load the client bootstrap that transfers the fragment to the public
    // update-password route. RootAuthGate redirects every other anonymous root
    // visit to /login before rendering protected application UI.
    pathname === "/" ||
    pathname === "/forgot-password" ||
    pathname === "/update-password" ||
    pathname.startsWith("/auth/");

  if (!user && !isPublicAuthRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  if (user && isLoginPage) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
