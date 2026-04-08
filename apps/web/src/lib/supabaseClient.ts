import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isMockMode = import.meta.env.VITE_MOCK_API === 'true';

// Fail fast in non-mock mode if env vars are missing.
// This surfaces a clear error in development rather than a cryptic Supabase failure.
if (!isMockMode) {
  if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL is not configured');
  if (!supabaseAnonKey) throw new Error('VITE_SUPABASE_ANON_KEY is not configured');
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,      // stores session in localStorage automatically (Supabase default)
    autoRefreshToken: true,    // silently refreshes access token before expiry
    detectSessionInUrl: false, // not using OAuth magic links
  },
});
