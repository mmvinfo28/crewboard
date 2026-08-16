import "server-only";

import { createHash, randomBytes } from "node:crypto";

export function createInvitationCode() {
  return randomBytes(24).toString("base64url");
}

export function hashInvitationCode(code: string) {
  return `\\x${createHash("sha256").update(code).digest("hex")}`;
}

