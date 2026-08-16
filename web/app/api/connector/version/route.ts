import { json } from "../../../../lib/connector/http";
import { connectorVersionPolicy } from "../../../../lib/connector/version";

export const dynamic = "force-dynamic";

export function GET() {
  return json(connectorVersionPolicy());
}
