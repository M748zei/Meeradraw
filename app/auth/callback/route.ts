import { NextResponse } from "next/server";

/** Reserved for OAuth redirect flows if needed later */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const next = searchParams.get("next") ?? "/dashboard";
  return NextResponse.redirect(`${origin}${next}`);
}
