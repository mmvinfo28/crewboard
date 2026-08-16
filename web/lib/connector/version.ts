import "server-only";

import { ApiInputError } from "./http";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

type ParsedVersion = {
  core: [number, number, number];
  prerelease: string | null;
};

function parseVersion(value: string): ParsedVersion | null {
  const match = value.match(VERSION_PATTERN);
  if (!match) return null;

  const core = match.slice(1, 4).map(Number) as [number, number, number];
  if (core.some((part) => !Number.isSafeInteger(part))) return null;
  return { core, prerelease: match[4] || null };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion) {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] < right.core[index] ? -1 : 1;
    }
  }

  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true });
}

export function connectorVersionPolicy() {
  return {
    minimumVersion: process.env.CREWBOARD_MIN_CONNECTOR_VERSION || "0.2.0",
    blockedVersions: (process.env.CREWBOARD_BLOCKED_CONNECTOR_VERSIONS || "")
      .split(",")
      .map((version) => version.trim())
      .filter(Boolean),
    message: process.env.CREWBOARD_CONNECTOR_VERSION_MESSAGE || null,
  };
}

export function assertConnectorVersionAllowed(version: string) {
  const parsed = parseVersion(version);
  if (!parsed) {
    throw new ApiInputError("invalid_version", "connectorVersion must be a semantic version", 400);
  }

  const policy = connectorVersionPolicy();
  const minimum = parseVersion(policy.minimumVersion);
  if (!minimum) throw new Error("CREWBOARD_MIN_CONNECTOR_VERSION must be a semantic version");

  const blocked = policy.blockedVersions.includes(version);
  if (blocked || compareVersions(parsed, minimum) < 0) {
    throw new ApiInputError(
      "connector_upgrade_required",
      policy.message || `Crewboard Connector ${policy.minimumVersion} or newer is required`,
      426,
    );
  }
}
