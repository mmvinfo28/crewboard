const JSON_HEADERS = { "Content-Type": "application/json" };

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || body?.message || `Request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }
  return body;
}

export function normalizeServerUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Crewboard server must use HTTP or HTTPS");
  return url.origin;
}

export async function startPairing(serverUrl, body) {
  return responseJson(await fetch(`${serverUrl}/api/connector/pair/start`, {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body),
  }));
}

export async function redeemPairing(serverUrl, code, pairingSecret) {
  return responseJson(await fetch(`${serverUrl}/api/connector/pair/redeem`, {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ code, pairingSecret }),
  }));
}

export async function rotateToken(config, connectorVersion) {
  return responseJson(await fetch(`${config.serverUrl}${config.tokenEndpoint || "/api/connector/token"}`, {
    method: "POST",
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${config.refreshToken}` },
    body: JSON.stringify({ connectorVersion }),
  }));
}

export async function rpc(token, functionName, body) {
  const response = await fetch(`${token.supabase.url}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      apikey: token.supabase.publishableKey,
      Authorization: `Bearer ${token.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  return responseJson(response);
}

