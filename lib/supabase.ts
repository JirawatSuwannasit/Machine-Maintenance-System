import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY are not set."
  );
}

// Single Supabase client instance for the whole app (browser/client components).
// Every file that needs Supabase must import `supabase` from here.
// Uses createBrowserClient so the session is stored in cookies (not
// localStorage), which lets middleware.ts and lib/supabase-server.ts read
// the same session on the server.
//
// The ONE allowed exception is middleware.ts, which must create its own
// per-request Supabase client bound to the middleware's request/response
// cookies -- this is the standard @supabase/ssr middleware pattern and
// cannot use a shared singleton.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
