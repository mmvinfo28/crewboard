import { createAdminClient } from "../../../../../lib/connector/admin";
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPairingCode,
  toPostgresBytea,
} from "../../../../../lib/connector/crypto";
import {
  apiError,
  handleRouteError,
  json,
  readJsonObject,
  requiredString,
} from "../../../../../lib/connector/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const code = requiredString(body, "code", 8, 9);
    const pairingSecret = requiredString(body, "pairingSecret", 32, 128);
    const refreshToken = createOpaqueToken();

    const { data, error } = await createAdminClient().rpc("connector_pair_redeem", {
      p_code_hash: toPostgresBytea(hashPairingCode(code)),
      p_pairing_secret_hash: toPostgresBytea(hashOpaqueToken(pairingSecret)),
      p_refresh_token_hash: toPostgresBytea(hashOpaqueToken(refreshToken)),
    });
    if (error) throw error;
    if (!data?.[0]) {
      return apiError("pairing_not_ready", "Pairing is pending, invalid, or expired", 409);
    }

    return json({
      device: {
        id: data[0].device_id,
        partyId: data[0].party_id,
        ownerId: data[0].owner_id,
      },
      session: {
        id: data[0].session_id,
        expiresAt: data[0].session_expires_at,
      },
      refreshToken,
      tokenEndpoint: "/api/connector/token",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
