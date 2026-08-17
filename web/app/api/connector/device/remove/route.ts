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
    const deviceId = requiredString(body, "deviceId", 36, 36);

    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return apiError("unauthorized", "Sign in before removing a device", 401);
    }

    const { data, error } = await createAdminClient().rpc("remove_device", {
      p_device_id: deviceId,
      p_user_id: claimsData.claims.sub,
    });
    if (error) {
      if (error.message.toLowerCase().includes("not allowed")) {
        return apiError("forbidden", "You cannot remove this device", 403);
      }
      throw error;
    }
    if (!data) return apiError("not_found", "Device was not found or was already removed", 404);

    return json({ removed: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
