import { authedClientFromRequest } from "@/lib/supabase/server";
import { decryptSecret, encryptionConfigured } from "@/lib/crypto/secretBox";
import { nvidiaUserOverride, nebiusUserOverride, type EndpointOverride } from "@/lib/modelGateway";

// Load the authenticated caller's own API key (if any) and turn it into a
// per-request inference override. Returns undefined when: encryption isn't
// configured, there is no session, or the user has no stored key. The decrypted
// key stays in server memory for this request only — never logged or returned.
export async function userOverrideFromRequest(req: Request): Promise<EndpointOverride | undefined> {
  if (!encryptionConfigured()) return undefined;
  const authed = await authedClientFromRequest(req);
  if (!authed) return undefined;
  const { data } = await authed.supabase
    .from("user_api_keys")
    .select("ciphertext,iv,auth_tag,provider,model")
    .eq("user_id", authed.userId)
    .maybeSingle();
  if (!data) return undefined;
  try {
    const key = decryptSecret({ ciphertext: data.ciphertext, iv: data.iv, tag: data.auth_tag });
    // A Nebius key routes the user's requests through Nebius Token Factory;
    // otherwise the NVIDIA open-model API is used.
    return data.provider === "nebius" ? nebiusUserOverride(key, data.model) : nvidiaUserOverride(key);
  } catch {
    return undefined;
  }
}
