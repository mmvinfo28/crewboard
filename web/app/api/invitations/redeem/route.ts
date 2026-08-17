import { createAdminClient } from "../../../../lib/connector/admin";
import { assertSameOrigin, apiError, handleRouteError, json, readJsonObject, requiredString } from "../../../../lib/connector/http";
import { hashInvitationCode } from "../../../../lib/invitations";
import { createClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const code = requiredString(body, "code", 32, 64);
    const supabase = await createClient();
    const { data: claimsData } = await supabase.auth.getClaims();
    const userId = claimsData?.claims?.sub;
    if (!userId) return apiError("unauthorized", "Sign in before joining a party", 401);

    const { data, error } = await createAdminClient().rpc("redeem_party_invitation", {
      p_code_hash: hashInvitationCode(code),
      p_user_id: userId,
    });
    if (error) {
      if (error.message.toLowerCase().includes("invalid or expired")) return apiError("invalid_invitation", "This invitation is invalid or expired", 404);
      throw error;
    }
    return json({ party: data?.[0] ?? null });
  } catch (error) {
    return handleRouteError(error);
  }
}

