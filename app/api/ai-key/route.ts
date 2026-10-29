import { NextResponse } from "next/server";
import { authedClientFromRequest } from "@/lib/supabase/server";
import { encryptionConfigured, encryptSecret, last4 } from "@/lib/crypto/secretBox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-user BYOK API-key management. The key is encrypted server-side (AES-256-GCM)
// and stored in public.user_api_keys (owner-only RLS). It is NEVER returned to
// the browser, logged, or placed in an error message — only a masked status
// (configured + last4 + provider) is exposed.

const TABLE = "user_api_keys";

/** GET — masked status only. */
export async function GET(req: Request) {
  const authed = await authedClientFromRequest(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await authed.supabase
    .from(TABLE)
    .select("provider,last4,model,updated_at")
    .eq("user_id", authed.userId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  return NextResponse.json({
    configured: !!data,
    provider: data?.provider ?? "nvidia",
    last4: data?.last4 ?? null,
    model: data?.model ?? null,
    updatedAt: data?.updated_at ?? null,
    encryptionReady: encryptionConfigured(),
  });
}

/** POST { key, provider?, model? } — validate, encrypt, store. Never echoes the key. */
export async function POST(req: Request) {
  const authed = await authedClientFromRequest(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Fail SAFE: never store plaintext if the encryption secret is missing.
  if (!encryptionConfigured()) {
    return NextResponse.json(
      { error: "Server encryption is not configured (BYOK_ENCRYPTION_KEY missing). Key not saved." },
      { status: 501 },
    );
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const provider = body?.provider === "nebius" ? "nebius" : "nvidia";
  const model = typeof body?.model === "string" ? body.model.trim().slice(0, 120) : "";
  if (key.length < 8 || key.length > 400) {
    return NextResponse.json({ error: "That doesn't look like a valid API key." }, { status: 400 });
  }

  let sealed;
  try { sealed = encryptSecret(key); } catch { return NextResponse.json({ error: "encryption failed" }, { status: 500 }); }

  const { error } = await authed.supabase.from(TABLE).upsert(
    {
      user_id: authed.userId,
      provider,
      model: model || null,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      auth_tag: sealed.tag,
      last4: last4(key),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return NextResponse.json({ error: "could not save key" }, { status: 500 });
  return NextResponse.json({ configured: true, provider, model: model || null, last4: last4(key) });
}

/** DELETE — remove the user's key. */
export async function DELETE(req: Request) {
  const authed = await authedClientFromRequest(req);
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { error } = await authed.supabase.from(TABLE).delete().eq("user_id", authed.userId);
  if (error) return NextResponse.json({ error: "could not remove key" }, { status: 500 });
  return NextResponse.json({ configured: false });
}
