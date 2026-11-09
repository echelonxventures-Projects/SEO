import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError, ErrorCodes } from "./errors";

/**
 * SSRF guard for every outbound request to a URL a workspace can configure
 * (webhook sinks, connectors, OAuth hosts, AI base URLs, SEO crawls…).
 *
 * - only http(s)
 * - the hostname is resolved and EVERY address must be public: loopback,
 *   RFC 1918, link-local (incl. cloud metadata 169.254.169.254), CGNAT,
 *   unique-local IPv6, multicast and unspecified are refused
 * - redirects are followed manually (max 5) and each hop is re-checked, so a
 *   public URL can't bounce the server into the internal network
 *
 * `OMNI_ALLOW_PRIVATE_EGRESS=1` lifts the address check (local dev / CI
 * receivers on localhost). It defaults ON outside production.
 */

const MAX_REDIRECTS = 5;

function privateEgressAllowed(): boolean {
  const flag = process.env.OMNI_ALLOW_PRIVATE_EGRESS;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return process.env.NODE_ENV !== "production";
}

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local + cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (v4ToInt(base) & mask);
    });
  }
  if (family === 6) {
    const a = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (a === "::" || a === "::1") return true;
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^f[cd]/.test(a)) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(a)) return true; // fe80::/10 link-local
    if (/^ff/.test(a)) return true; // multicast
    return false;
  }
  return true; // not an IP at all — treat as unsafe
}

export async function assertPublicUrl(raw: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(ErrorCodes.VALIDATION, "Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AppError(ErrorCodes.VALIDATION, `URL scheme ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    throw new AppError(ErrorCodes.VALIDATION, "Credentials in URLs are not allowed");
  }
  if (privateEgressAllowed()) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true, verbatim: true })
        .then((r) => r.map((x) => x.address))
        .catch(() => {
          throw new AppError(ErrorCodes.VALIDATION, `Could not resolve host ${host}`);
        });
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new AppError(ErrorCodes.FORBIDDEN, `Outbound requests to ${host} are blocked (private or internal address)`);
  }
  return url;
}

/** Drop-in `fetch` for workspace-controlled URLs. */
export async function guardedFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  let url = await assertPublicUrl(input);
  let opts: RequestInit = { ...init, redirect: "manual" };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, opts);
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    if (init.redirect === "manual") return res;
    if (init.redirect === "error") throw new TypeError("Redirect encountered");
    url = await assertPublicUrl(new URL(location, url));
    // 303 (and 301/302 for POST, per fetch spec) switch to GET without a body.
    const method = (opts.method ?? "GET").toUpperCase();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      opts = { ...opts, method: "GET", body: undefined };
    }
  }
  throw new AppError(ErrorCodes.VALIDATION, "Too many redirects");
}
