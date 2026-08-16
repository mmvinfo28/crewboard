import { createAdminClient } from "../../../../../lib/connector/admin";
import {
  createOpaqueToken,
  createPairingCode,
  hashIpAddress,
  hashOpaqueToken,
  hashPairingCode,
  toPostgresBytea,
} from "../../../../../lib/connector/crypto";
import {
  apiError,
  clientIp,
  handleRouteError,
  json,
  readJsonObject,
  requiredString,
} from "../../../../../lib/connector/http";
import { assertConnectorVersionAllowed } from "../../../../../lib/connector/version";

export const dynamic = "force-dynamic";

const PLATFORMS = new Set(["macos", "windows", "linux", "unknown"]);

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const deviceName = requiredString(body, "deviceName", 1, 120);
    const platform = requiredString(body, "platform", 1, 20).toLowerCase();
    const connectorVersion = requiredString(body, "connectorVersion", 1, 40);
    assertConnectorVersionAllowed(connectorVersion);
    if (!PLATFORMS.has(platform)) {
      return apiError("invalid_platform", "Unsupported device platform", 400);
    }

    const pairingSecret = createOpaqueToken();
    const ipHash = toPostgresBytea(hashIpAddress(clientIp(request)));
    const admin = createAdminClient();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = createPairingCode();
      const { data, error } = await admin.rpc("connector_pair_start", {
        p_code_hash: toPostgresBytea(hashPairingCode(code)),
        p_pairing_secret_hash: toPostgresBytea(hashOpaqueToken(pairingSecret)),
        p_request_ip_hash: ipHash,
        p_device_name: deviceName,
        p_platform: platform,
        p_connector_version: connectorVersion,
      });

      if (!error && data?.[0]) {
        return json(
          {
            pairingId: data[0].pairing_id,
            code,
            pairingSecret,
            expiresAt: data[0].expires_at,
            pollAfterSeconds: 2,
          },
          { status: 201 },
        );
      }
      if (error?.code !== "23505") {
        if (error?.message.toLowerCase().includes("rate limit")) {
          return apiError("rate_limited", "Too many pairing attempts. Try again later.", 429);
        }
        throw error;
      }
    }

    return apiError("code_collision", "Could not create a pairing code. Please retry.", 503);
  } catch (error) {
    return handleRouteError(error);
  }
}
