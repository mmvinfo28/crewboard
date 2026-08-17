import { createAdminClient } from "../../../lib/connector/admin";
import { assertSameOrigin, apiError, handleRouteError, json, readJsonObject, requiredString } from "../../../lib/connector/http";
import { createInvitationCode, hashInvitationCode } from "../../../lib/invitations";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const partyId = requiredString(body, "partyId", 36, 36);
    const role = body.role === "viewer" ? "viewer" : "member";
    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    const userId = claimsData?.claims?.sub;
    if (!userId) return apiError("unauthorized", "Sign in before creating an invitation", 401);

    const admin = createAdminClient();
    const { data: membership } = await admin.from("party_members").select("role").eq("party_id", partyId).eq("user_id", userId).maybeSingle();
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return apiError("forbidden", "Only party owners and admins can invite people", 403);
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin.from("invitations").select("id", { count: "exact", head: true }).eq("created_by", userId).gte("created_at", oneHourAgo);
    if ((count ?? 0) >= 20) return apiError("rate_limited", "Too many invitations. Try again later", 429);

    const code = createInvitationCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await admin.from("invitations").insert({
      party_id: partyId,
      created_by: userId,
      code_hash: hashInvitationCode(code),
      role,
      max_uses: 25,
      expires_at: expiresAt,
    });
    if (error) throw error;

    return json({ url: `${new URL(request.url).origin}/join/${code}`, expiresAt }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

