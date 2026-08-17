import { createAdminClient } from "../../../../lib/connector/admin";
import {
  createOpaqueToken,
  hashOpaqueToken,
  signConnectorAccessToken,
  toPostgresBytea,
} from "../../../../lib/connector/crypto";
import {
  apiError,
  bearerToken,
  handleRouteError,
  json,
  readJsonObject,
  requiredString,
} from "../../../../lib/connector/http";
import { assertConnectorVersionAllowed } from "../../../../lib/connector/version";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const refreshToken = bearerToken(request);
    const body = await readJsonObject(request);
    const connectorVersion = requiredString(body, "connectorVersion", 1, 40);
    assertConnectorVersionAllowed(connectorVersion);
    const nextRefreshToken = createOpaqueToken();

    const { data, error } = await createAdminClient().rpc("connector_rotate_session", {
      p_refresh_token_hash: toPostgresBytea(hashOpaqueToken(refreshToken)),
      p_next_refresh_token_hash: toPostgresBytea(hashOpaqueToken(nextRefreshToken)),
      p_connector_version: connectorVersion,
    });
    if (error) throw error;
    if (!data?.[0]) {
      return apiError("invalid_session", "Device session is invalid, expired, or revoked", 401);
    }

    const identity = {
      sessionId: data[0].session_id,
      deviceId: data[0].device_id,
      partyId: data[0].party_id,
      ownerId: data[0].owner_id,
      tokenGeneration: data[0].token_generation,
    };
    const token = await signConnectorAccessToken(identity);

    return json({
      ...token,
      refreshToken: nextRefreshToken,
      identity,
      supabase: {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        wakeupTopic: `party:${identity.partyId}`,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
