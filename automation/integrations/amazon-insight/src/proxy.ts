import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicApi = ["/api/auth/login", "/api/auth/bootstrap", "/api/auth/create-member", "/api/auth/status", "/api/auth/logout"];

export default function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const protectedPage = !path.startsWith("/api/") && path !== "/login" && path !== "/health";
  const protectedApi = path.startsWith("/api/") && !publicApi.includes(path);
  if ((protectedPage || protectedApi) && !request.cookies.has("measureman_session")) {
    if (protectedApi) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(path)}`, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
