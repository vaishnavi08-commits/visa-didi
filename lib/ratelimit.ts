// Per-device rate limit (there is no login): shared across server instances via Supabase.
import { allowRequest } from "./persist";

export function allow(deviceKey: string) {
  return allowRequest(deviceKey, 10 * 60, 20);
}
