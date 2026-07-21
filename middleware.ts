import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "__session";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const configured = Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);

  const isAuthRoute =
    path.startsWith("/login") || path.startsWith("/signup") || path.startsWith("/auth");
  const isProtected =
    path.startsWith("/dashboard") ||
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

  if (!session && isProtected) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", path);
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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
