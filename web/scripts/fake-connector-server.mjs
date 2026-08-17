import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

const port = Number.parseInt(process.env.CREWBOARD_FAKE_PORT || "4310", 10);
const pairings = new Map();
const sessions = new Map();

function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function token() {
  return randomBytes(32).toString("base64url");
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/connector/version") {
      return send(response, 200, { minimumVersion: "0.1.0", blockedVersions: [], message: null });
    }
    if (request.method === "POST" && url.pathname === "/api/connector/pair/start") {
      const input = await body(request);
      const code = randomBytes(4).toString("hex").toUpperCase();
      const pairingSecret = token();
      const pairingId = randomUUID();
      pairings.set(code, { input, pairingSecret, pairingId, approved: false });
      return send(response, 201, {
        pairingId,
        code: `${code.slice(0, 4)}-${code.slice(4)}`,
        pairingSecret,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        pollAfterSeconds: 2,
      });
    }
    if (request.method === "POST" && url.pathname === "/__fake/approve") {
      const input = await body(request);
      const code = String(input.code || "").replace(/\W/g, "").toUpperCase();
      const pairing = pairings.get(code);
      if (!pairing) return send(response, 404, { error: { code: "invalid_code", message: "Unknown code" } });
      pairing.approved = true;
      return send(response, 200, { approved: true });
    }
    if (request.method === "POST" && url.pathname === "/api/connector/pair/redeem") {
      const input = await body(request);
      const code = String(input.code || "").replace(/\W/g, "").toUpperCase();
      const pairing = pairings.get(code);
      if (!pairing?.approved || pairing.pairingSecret !== input.pairingSecret) {
        return send(response, 409, { error: { code: "pairing_not_ready", message: "Pairing is not ready" } });
      }
      const refreshToken = token();
      const identity = {
        sessionId: randomUUID(), deviceId: randomUUID(), partyId: randomUUID(), ownerId: randomUUID(),
      };
      sessions.set(refreshToken, identity);
      pairings.delete(code);
      return send(response, 200, {
        device: { id: identity.deviceId, partyId: identity.partyId, ownerId: identity.ownerId },
        session: { id: identity.sessionId, expiresAt: new Date(Date.now() + 2_592_000_000).toISOString() },
        refreshToken,
        tokenEndpoint: "/api/connector/token",
      });
    }
    if (request.method === "POST" && url.pathname === "/api/connector/token") {
      const current = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const identity = sessions.get(current);
      if (!identity) return send(response, 401, { error: { code: "invalid_session", message: "Invalid session" } });
      const next = token();
      sessions.delete(current);
      sessions.set(next, identity);
      return send(response, 200, {
        accessToken: "fake.jwt.for-contract-testing",
        expiresIn: 300,
        refreshToken: next,
        identity: { ...identity, tokenGeneration: 2 },
        supabase: {
          url: "https://example.supabase.co",
          publishableKey: "sb_publishable_fake",
          wakeupTopic: `party:${identity.partyId}`,
        },
      });
    }
    return send(response, 404, { error: { code: "not_found", message: "Not found" } });
  } catch {
    return send(response, 400, { error: { code: "invalid_request", message: "Invalid request" } });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Crewboard fake connector API listening on http://127.0.0.1:${port}`);
});
