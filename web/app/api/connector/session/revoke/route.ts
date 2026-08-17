import { createAdminClient } from "../../../../../lib/connector/admin";
import { createClient } from "../../../../../lib/supabase/server";
import {
  apiError,
  assertSameOrigin,
  handleRouteError,
  json,
  readJsonObject,
  requiredString,
} from "../../../../../lib/connector/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const sessionId = requiredString(body, "sessionId", 36, 36);

    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return apiError("unauthorized", "Sign in before revoking a connector", 401);
    }

    const { data, error } = await createAdminClient().rpc("revoke_device_session", {
      p_session_id: sessionId,
      p_user_id: claimsData.claims.sub,
    });
    if (error) {
      if (error.message.toLowerCase().includes("not allowed")) {
        return apiError("forbidden", "You cannot revoke this device session", 403);
      }
      throw error;
    }
    if (!data) return apiError("not_found", "Device session was not found", 404);

    return json({ revoked: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
