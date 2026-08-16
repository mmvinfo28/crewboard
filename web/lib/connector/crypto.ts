import "server-only";

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { importJWK, SignJWT, type JWK } from "jose";

const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;

function pairingPepper() {
  const value = process.env.CREWBOARD_PAIRING_PEPPER;
  if (!value || value.length < 32) {
    throw new Error("CREWBOARD_PAIRING_PEPPER must contain at least 32 characters");
  }
  return value;
}

export function normalizePairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function createPairingCode() {
  const bytes = randomBytes(8);
  let raw = "";
  for (const byte of bytes) raw += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPairingCode(value: string) {
  return createHmac("sha256", pairingPepper())
    .update(`pairing-code:${normalizePairingCode(value)}`)
    .digest();
}

export function hashIpAddress(value: string) {
  return createHmac("sha256", pairingPepper())
    .update(`pairing-ip:${value}`)
    .digest();
}

export function hashOpaqueToken(value: string) {
  return createHash("sha256").update(value).digest();
}

export function toPostgresBytea(value: Buffer) {
  return `\\x${value.toString("hex")}`;
}

function signingJwk() {
  const raw = process.env.CREWBOARD_CONNECTOR_JWT_PRIVATE_JWK;
  if (!raw) throw new Error("Connector JWT signing key is not configured");

  const jwk = JSON.parse(raw) as JWK;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.kid) {
    throw new Error("Connector signing key must be a private P-256 JWK with a kid");
  }
  return jwk;
}

export type ConnectorTokenIdentity = {
  sessionId: string;
  deviceId: string;
  partyId: string;
  ownerId: string;
  tokenGeneration: number;
};

export async function signConnectorAccessToken(identity: ConnectorTokenIdentity) {
  const jwk = signingJwk();
  const key = await importJWK(jwk, "ES256");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");

  const accessToken = await new SignJWT({
    role: "authenticated",
    connector: true,
    device_id: identity.deviceId,
    party_id: identity.partyId,
    owner_id: identity.ownerId,
    session_id: identity.sessionId,
    token_generation: identity.tokenGeneration,
  })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
    .setSubject(identity.sessionId)
    .setIssuer(`${supabaseUrl.replace(/\/$/, "")}/auth/v1`)
    .setAudience("authenticated")
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(key);

  return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}
