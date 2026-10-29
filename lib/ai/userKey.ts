import { authedClientFromRequest } from "@/lib/supabase/server";
import { decryptSecret, encryptionConfigured } from "@/lib/crypto/secretBox";
import { nvidiaUserOverride, type EndpointOverride } from "@/lib/modelGateway";

// Load the authenticated caller's own API key (if any) and turn it into a
// per-request inference override. Returns null when: encryption isn't
// configured, there is no session, or the user has no stored key. The decrypted
// key stays in server memory for this request only — never logged or returned.
export async function userOverrideFromRequest(req: Request): Promise<EndpointOverride | undefined> {
  if (!encryptionConfigured()) return undefined;
  const authed = await authedClientFromRequest(req);
  if (!authed) return undefined;
  const { data } = await authed.supabase
    .from("user_api_keys")
    .select("ciphertext,iv,auth_tag,provider")
    .eq("user_id", authed.userId)
    .maybeSingle();
  if (!data) return undefined;
  try {
    const key = decryptSecret({ ciphertext: data.ciphertext, iv: data.iv, tag: data.auth_tag });
    // Only NVIDIA BYOK is supported today; Nebius stays an owner-config option.
    return nvidiaUserOverride(key);
  } catch {
    return undefined;
  }
}
