import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { error } = await supabase.from("parties").select("id", { count: "exact", head: true });

  return NextResponse.json(
    error
      ? { status: "error", database: "unavailable" }
      : { status: "ok", database: "connected" },
    { status: error ? 503 : 200 },
  );
}
