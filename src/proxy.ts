import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js Proxy (formerly middleware): security response headers for every
 * document/API response. Authorization itself happens in the route layer
 * (proxy is not a security boundary, headers are defense-in-depth).
 */
export function proxy(request: NextRequest) {
  const isProd = process.env.NODE_ENV === "production";
  // Embeddable widget documents must be frameable by third-party sites. The
  // per-widget origin allowlist is enforced by the /embed page itself (it
  // renders nothing for a non-allowlisted embedder), so framing is opened
  // here and X-Frame-Options is omitted for these paths only.
  const embeddable = request.nextUrl.pathname.startsWith("/embed/");
  const incoming = request.headers.get("x-request-id");
  const rid = incoming && /^[\w.-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://api.stripe.com https://js.stripe.com",
    "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    embeddable ? "frame-ancestors *" : "frame-ancestors 'none'",
    isProd ? "upgrade-insecure-requests" : "",
  ]
    .filter(Boolean)
    .join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", rid);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", rid);
  response.headers.set("X-Content-Type-Options", "nosniff");
  if (!embeddable) response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
  if (isProd) {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and source files with extensions.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
