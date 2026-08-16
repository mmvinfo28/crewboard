import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next")?.startsWith("/")
    ? url.searchParams.get("next")!
    : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const displayName = typeof data.user.user_metadata.display_name === "string"
        ? data.user.user_metadata.display_name
        : data.user.email?.split("@")[0] ?? "Member";

      await supabase.from("profiles").upsert({
        id: data.user.id,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      });
    }

    if (error) {
      return NextResponse.redirect(new URL("/login?error=confirmation_failed", url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
