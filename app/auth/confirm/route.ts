// Supabase's SSR email-template convention uses /auth/confirm. Keep the
// callback route as the single implementation so both configured URLs work.
export { GET } from "../callback/route";
