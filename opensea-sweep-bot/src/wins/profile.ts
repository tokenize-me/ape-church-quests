import type { SupabaseClient } from '@supabase/supabase-js';

export interface UserProfile {
  username: string | null;
  xHandle: string | null;
}

// Fetches the username + x_handle for a single address. Replaces the IN-join
// the polling source does today. Returns null (not throw) on a missing user
// so the listener can fall through to address-truncation display.
export async function fetchUserProfile(
  supabase: SupabaseClient,
  address: string,
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('username, x_handle')
    .eq('user_address', address.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(`users lookup failed for ${address}: ${error.message}`);
  }
  if (!data) return null;
  return { username: data.username ?? null, xHandle: data.x_handle ?? null };
}
