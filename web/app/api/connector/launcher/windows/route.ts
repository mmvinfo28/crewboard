import type { NextRequest } from "next/server";

export function GET(request: NextRequest) {
  const serverUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).origin;
  const script = [
    "@echo off",
    "setlocal",
    "title Crewboard Connector",
    "echo.",
    "echo   CREWBOARD CONNECTOR",
    "echo   This window keeps Claude and Codex connected to your party.",
    "echo.",
    "where node.exe >nul 2>nul",
    "if errorlevel 1 (",
    "  echo Node.js is required. Download it from https://nodejs.org/ then open this file again.",
    "  pause",
    "  exit /b 1",
    ")",
    `if exist "%APPDATA%\\Crewboard\\connector.json" (npx --yes github:mmvinfo28/crewboard#agent/crewboard-web-app run --url "${serverUrl}") else (npx --yes github:mmvinfo28/crewboard#agent/crewboard-web-app connect --url "${serverUrl}")`,
    "echo.",
    "echo Crewboard stopped. You can open this file again whenever you need it.",
    "pause",
    "endlocal",
    "",
  ].join("\r\n");

  return new Response(script, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="Crewboard Connector.cmd"',
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
