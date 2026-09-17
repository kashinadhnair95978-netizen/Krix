import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

// Use placeholders so the module imports cleanly before env vars are set
// (e.g. during `next build` or before .env.local exists).
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://placeholder.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

// Server-side client. Used by API route handlers. Sessions are managed
// server-side via cookies (middleware) or the service-role client.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const supabaseServer = () => {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

// Browser client for client components. Persists the session to cookies
// (via @supabase/ssr) so middleware.ts and API route handlers that read
// cookies via createServerClient can see it.
export const browserSupabase = createBrowserClient(supabaseUrl, supabaseAnonKey);