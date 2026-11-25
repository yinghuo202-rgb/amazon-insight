import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { verifySignedSessionCookie } from "@/lib/session-signature";

const publicApi = ["/api/auth/login", "/api/auth/bootstrap", "/api/auth/status", "/api/auth/logout"];

export default function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const protectedPage = !path.startsWith("/api/") && path !== "/login" && path !== "/health";
  const isBearerApi = path.startsWith("/api/crawlers/") || path.startsWith("/api/worker/");
  const hasBearer = request.headers.get("authorization")?.toLowerCase().startsWith("bearer ");
  const protectedApi = path.startsWith("/api/") && !publicApi.includes(path) && !(isBearerApi && hasBearer);

  if (protectedPage || protectedApi) {
    const cookieValue = request.cookies.get("measureman_session")?.value;
    const validToken = verifySignedSessionCookie(cookieValue);
    if (!validToken) {
      if (protectedApi) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }
      return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(path)}`, request.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
