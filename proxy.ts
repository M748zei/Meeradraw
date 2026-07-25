import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "__session";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const configured = Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);

  const isAuthRoute =
    path.startsWith("/login") || path.startsWith("/signup") || path.startsWith("/auth");
  const isPurchaseOpen = path.startsWith("/ouvrir-mon-acces");
  const isProtected =
    path.startsWith("/dashboard") ||
    path.startsWith("/create") ||
    path.startsWith("/universes") ||
    path.startsWith("/books") ||
    path.startsWith("/library") ||
    path.startsWith("/credits") ||
    path.startsWith("/license") ||
    path.startsWith("/profile") ||
    path.startsWith("/settings");

  // Without Firebase config, allow demo browsing of app pages
  if (!configured) {
    return NextResponse.next();
  }

  // Post-purchase flow must stay public (cookie context + verify/attach APIs).
  if (isPurchaseOpen) {
    return NextResponse.next();
  }

  if (!session && isProtected) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", path);
    return NextResponse.redirect(redirectUrl);
  }

  // Never silently dump a purchase context into generic login: if a signed
  // purchase cookie is present, send the buyer back to the dedicated flow.
  const purchaseCtx = request.cookies.get("__md_purchase")?.value;
  if (session && isAuthRoute && purchaseCtx) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/ouvrir-mon-acces";
    return NextResponse.redirect(redirectUrl);
  }

  if (session && isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude Workflow internal paths — middleware must not intercept
    // POST /.well-known/workflow/v1/* or runs hang / fail to resume.
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
