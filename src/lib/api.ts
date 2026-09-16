"use client";

export type ApiError = { code: string; message: string; details?: unknown };

export class ApiCallError extends Error {
  code: string;
  details?: unknown;
  status: number;
  constructor(status: number, err: ApiError) {
    super(err.message || `Request failed (${status})`);
    this.code = err.code;
    this.details = err.details;
    this.status = status;
  }
}

function getCsrf(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)omnimark_csrf=([^;]+)/);
  return m ? m[1] : null;
}

async function doFetch(method: string, path: string, body?: unknown, raw = false): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !raw) headers["content-type"] = "application/json";
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = getCsrf();
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? (body as string) : JSON.stringify(body),
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login";
  }
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  let json: { data?: T; error?: ApiError } | null = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new ApiCallError(res.status, json?.error ?? { code: "INTERNAL", message: `Request failed (${res.status})` });
  }
  return (json?.data ?? null) as T;
}

export const api = {
  get: <T>(path: string) => doFetch("GET", path).then(parse<T>),
  post: <T>(path: string, body?: unknown) => doFetch("POST", path, body ?? {}).then(parse<T>),
  patch: <T>(path: string, body: unknown) => doFetch("PATCH", path, body).then(parse<T>),
  del: <T>(path: string, body?: unknown) => doFetch("DELETE", path, body).then(parse<T>),
};
