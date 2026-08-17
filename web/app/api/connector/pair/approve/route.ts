import { createClient } from "../../../../../lib/supabase/server";
import { createAdminClient } from "../../../../../lib/connector/admin";
import { hashPairingCode, toPostgresBytea } from "../../../../../lib/connector/crypto";
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
    const code = requiredString(body, "code", 8, 9);
    const partyId = requiredString(body, "partyId", 36, 36);

    const supabase = await createClient();
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || !claimsData?.claims?.sub) {
      return apiError("unauthorized", "Sign in before approving a connector", 401);
    }

    const { data, error } = await createAdminClient().rpc("approve_device_pairing", {
      p_code_hash: toPostgresBytea(hashPairingCode(code)),
      p_party_id: partyId,
      p_user_id: claimsData.claims.sub,
    });
    if (error) {
      if (error.message.toLowerCase().includes("invalid or expired")) {
        return apiError("invalid_code", "The pairing code is invalid or expired", 404);
      }
      if (error.message.toLowerCase().includes("not allowed")) {
        return apiError("forbidden", "You cannot add devices to this party", 403);
      }
      throw error;
    }

    return json({ pairing: data?.[0] ?? null });
  } catch (error) {
    return handleRouteError(error);
  }
}
