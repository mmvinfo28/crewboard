import "server-only";

import { NextResponse } from "next/server";

export function json(data: unknown, init?: ResponseInit) {
  const response = NextResponse.json(data, init);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function apiError(code: string, message: string, status: number) {
  return json({ error: { code, message } }, { status });
}

export async function readJsonObject(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiInputError("content_type", "Expected application/json", 415);
  }

  const value: unknown = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiInputError("invalid_body", "Expected a JSON object", 400);
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  body: Record<string, unknown>,
  key: string,
  minLength: number,
  maxLength: number,
) {
  const value = body[key];
  if (typeof value !== "string") {
    throw new ApiInputError("invalid_body", `${key} must be a string`, 400);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new ApiInputError(
      "invalid_body",
      `${key} must contain between ${minLength} and ${maxLength} characters`,
      400,
    );
  }
  return trimmed;
}

export function clientIp(request: Request) {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{32,512})$/i);
  if (!match) throw new ApiInputError("unauthorized", "A device refresh token is required", 401);
  return match[1];
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new ApiInputError("invalid_origin", "Missing request origin", 403);

  const allowed = new Set([new URL(request.url).origin]);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) allowed.add(new URL(siteUrl).origin);
  if (!allowed.has(new URL(origin).origin)) {
    throw new ApiInputError("invalid_origin", "Request origin is not allowed", 403);
  }
}

export class ApiInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function handleRouteError(error: unknown) {
  if (error instanceof ApiInputError) {
    return apiError(error.code, error.message, error.status);
  }
  console.error("Connector API error", error);
  return apiError("internal_error", "The connector service is temporarily unavailable", 500);
}
