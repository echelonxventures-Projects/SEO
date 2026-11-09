/**
 * TPaaS consumption layer — GraphQL gateway + generated SDK snippets.
 *
 * GraphQL: a single read-only endpoint over the temporal core (calendars,
 * patterns, events, occurrences, appointments, resources, shifts, triggers,
 * analytics). It reuses the same service-layer tenancy guards; no new auth.
 *
 * SDKs: server-generated, dependency-free client snippets (TypeScript/JS,
 * Python, Go, Java, Ruby, PHP, C#) for the public REST surface, generated from
 * one route descriptor so they never drift from the API.
 */

import { AppError, ErrorCodes } from "../errors";
import type { Ctx } from "./common";
import { agenda, listCalendars, listPatterns, listEvents, listTimeSystems } from "./temporal.service";
import { listAppointments, openSlots } from "./temporal-booking.service";
import { listResources, listShifts, listAvailability } from "./temporal-resources.service";
import { listTriggers } from "./temporal-triggers.service";
import { temporalAnalytics } from "./temporal-intelligence.service";

type QueryArgs = Record<string, unknown>;

const QUERIES: Record<string, (ctx: Ctx, args: QueryArgs) => Promise<unknown>> = {
  calendars: async (ctx) => listCalendars(ctx),
  patterns: async (ctx) => listPatterns(ctx),
  events: async (ctx, args) => listEvents(ctx, toParams(args)),
  appointments: async (ctx, args) => listAppointments(ctx, toParams(args)),
  resources: async (ctx, args) => listResources(ctx, toParams(args)),
  shifts: async (ctx) => listShifts(ctx),
  availability: async (ctx) => listAvailability(ctx),
  triggers: async (ctx) => listTriggers(ctx),
  timeSystems: async (ctx) => listTimeSystems(ctx),
  agenda: async (ctx, args) => agenda(ctx, toParams(args)),
  openSlots: async (ctx, args) => openSlots(ctx, toParams(args)),
  analytics: async (ctx, args) => temporalAnalytics(ctx, toParams(args)),
};

/**
 * Each field needs the SAME permission as its REST twin — the gateway must
 * never be a way around RBAC (e.g. reading attendee PII with temporal.read).
 */
const FIELD_PERMISSION: Record<keyof typeof QUERIES, string> = {
  calendars: "temporal.read",
  patterns: "temporal.read",
  events: "temporal.read",
  appointments: "appointment.read",
  resources: "resource.read",
  shifts: "workforce.read",
  availability: "resource.read",
  triggers: "temporal.read",
  timeSystems: "temporal.read",
  agenda: "temporal.read",
  openSlots: "appointment.read",
  analytics: "temporal.read",
};

const MAX_FIELDS = Object.keys(QUERIES).length;

function toParams(args: QueryArgs): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) if (v != null) p.set(k, String(v));
  return p;
}

export async function graphql(ctx: Ctx, input: unknown) {
  const { query, variables } = (input ?? {}) as { query?: string; variables?: QueryArgs };
  if (!query || typeof query !== "string") throw new AppError(ErrorCodes.VALIDATION, "A GraphQL `query` string is required");
  if (!/^\s*(query|\{)/i.test(query)) throw new AppError(ErrorCodes.VALIDATION, "Only read queries are supported (no mutations in the temporal gateway)");
  if (query.length > 4_000) throw new AppError(ErrorCodes.VALIDATION, "Query too long");
  // Deduplicate: `{ analytics analytics … }` must not re-run expensive resolvers.
  const fields = [...new Set(
    [...query.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(([^)]*)\))?/g)]
      .map((m) => m[1])
      .filter((name) => Object.prototype.hasOwnProperty.call(QUERIES, name)),
  )].slice(0, MAX_FIELDS);
  if (!fields.length) throw new AppError(ErrorCodes.VALIDATION, "No known temporal fields in query. Available: " + Object.keys(QUERIES).join(", "));
  const held = ctx.viewer.active?.permissions ?? new Set<string>();
  const denied = fields.filter((f) => !held.has(FIELD_PERMISSION[f as keyof typeof QUERIES]));
  if (denied.length) {
    throw new AppError(
      ErrorCodes.FORBIDDEN,
      `Missing permission for field(s): ${denied.map((f) => `${f} (${FIELD_PERMISSION[f as keyof typeof QUERIES]})`).join(", ")}`,
    );
  }
  const args: QueryArgs = { ...(variables ?? {}) };
  const data: Record<string, unknown> = {};
  for (const f of fields) data[f] = await QUERIES[f](ctx, args);
  return { data };
}

export function graphqlSchemaDoc() {
  return {
    note: 'Read-only temporal gateway. Send { query: "{ calendars patterns agenda }" }',
    queries: Object.keys(QUERIES),
    mutations: [],
    consumers: "REST /api/v1/temporal/* remains the write surface (RBAC + CSRF + idempotency).",
  };
}

// ---------------------------------------------------------------------------
// SDK generation — one descriptor, many languages, zero drift
// ---------------------------------------------------------------------------

type Endpoint = { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; name: string; body?: string };

const REST_SURFACE: Endpoint[] = [
  { method: "GET", path: "/api/v1/temporal/calendars", name: "listCalendars" },
  { method: "POST", path: "/api/v1/temporal/calendars", name: "createCalendar", body: "{ name, code, timezone, kind }" },
  { method: "GET", path: "/api/v1/temporal/patterns", name: "listPatterns" },
  { method: "POST", path: "/api/v1/temporal/patterns", name: "createPattern", body: "{ name, dsl }" },
  { method: "POST", path: "/api/v1/temporal/dsl/compile", name: "compileDsl", body: "{ dsl }" },
  { method: "GET", path: "/api/v1/temporal/events", name: "listEvents" },
  { method: "POST", path: "/api/v1/temporal/events", name: "createEvent", body: "{ calendarId, title, startsAt, endsAt, patternId }" },
  { method: "GET", path: "/api/v1/temporal/agenda", name: "agenda" },
  { method: "GET", path: "/api/v1/temporal/timeline", name: "timeline" },
  { method: "GET", path: "/api/v1/temporal/appointments", name: "listAppointments" },
  { method: "POST", path: "/api/v1/temporal/appointments/book", name: "bookAppointment", body: "{ slotId, attendeeName }" },
  { method: "GET", path: "/api/v1/temporal/slots/open", name: "openSlots" },
  { method: "GET", path: "/api/v1/temporal/resources", name: "listResources" },
  { method: "POST", path: "/api/v1/temporal/resources", name: "createResource", body: "{ name, code, type, capacity }" },
  { method: "GET", path: "/api/v1/temporal/workforce/shifts", name: "listShifts" },
  { method: "GET", path: "/api/v1/temporal/triggers", name: "listTriggers" },
  { method: "POST", path: "/api/v1/temporal/triggers", name: "createTrigger", body: "{ name, anchorType, consumerType }" },
  { method: "GET", path: "/api/v1/temporal/analytics", name: "analytics" },
  { method: "GET", path: "/api/v1/temporal/monitor", name: "monitor" },
  { method: "GET", path: "/api/v1/public/booking/{token}", name: "publicSlots" },
  { method: "POST", path: "/api/v1/public/booking/{token}", name: "publicBook", body: "{ slotId, attendeeName }" },
];

export type SdkLanguage = "typescript" | "python" | "go" | "java" | "ruby" | "php" | "csharp" | "curl";

function paramsOf(e: Endpoint): string[] {
  const out: string[] = [];
  if (e.method !== "GET" && e.body) out.push("body");
  if (e.path.includes("{token}")) out.push("token");
  return out;
}

export function generateSdk(language: string): { language: string; filename: string; content: string } {
  const lang = language.toLowerCase() as SdkLanguage;
  switch (lang) {
    case "typescript": {
      const methods = REST_SURFACE.map((e) => {
        const ps = paramsOf(e);
        const sig = ps.length ? "(" + ps.map((x) => x + ": unknown").join(", ") + ")" : "()";
        const bodyArg = e.method === "GET" ? "" : ", body";
        const url = e.path.replace("{token}", "${token}");
        return "  " + e.name + sig + " { return this.call(" + JSON.stringify(e.method) + ", `" + url + "`" + bodyArg + "); }";
      }).join("\n");
      return {
        language: "typescript",
        filename: "omnimark-temporal.ts",
        content:
          "// OmniMark Universal Temporal Platform SDK (generated)\n" +
          "export class TemporalClient {\n" +
          "  constructor(private baseUrl: string, private apiKey: string) {}\n" +
          "  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {\n" +
          "    const res = await fetch(this.baseUrl + path, {\n" +
          "      method,\n" +
          '      headers: { "content-type": "application/json", authorization: "Bearer " + this.apiKey },\n' +
          "      body: body === undefined ? undefined : JSON.stringify(body),\n" +
          "    });\n" +
          "    const json = await res.json();\n" +
          '    if (!res.ok) throw new Error(json?.error?.message ?? res.statusText);\n' +
          "    return json.data as T;\n" +
          "  }\n" +
          methods +
          "\n}\n",
      };
    }
    case "python": {
      const methods = REST_SURFACE.map((e) => {
        const ps = paramsOf(e);
        const sig = ps.length ? "self, " + ps.join(", ") : "self";
        const pass = e.method === "GET" ? "" : ", payload";
        const tok = e.path.includes("{token}") ? ", token" : "";
        return "    def " + snake(e.name) + "(" + sig + "):\n        return self._call(" + JSON.stringify(e.method) + ", " + JSON.stringify(e.path) + pass + tok + ")";
      }).join("\n\n");
      return {
        language: "python",
        filename: "omnimark_temporal.py",
        content:
          '"""OmniMark Universal Temporal Platform SDK (generated)."""\n' +
          "import json, urllib.request\n\n" +
          "class TemporalClient:\n" +
          "    def __init__(self, base_url, api_key):\n" +
          "        self.base_url, self.api_key = base_url, api_key\n\n" +
          "    def _call(self, method, path, body=None, token=None):\n" +
          '        url = self.base_url + (path.replace("{token}", token or "") if token is not None else path)\n' +
          "        data = json.dumps(body).encode() if body is not None else None\n" +
          '        req = urllib.request.Request(url, data=data, method=method, headers={\n' +
          '            "content-type": "application/json", "authorization": "Bearer " + self.api_key})\n' +
          "        with urllib.request.urlopen(req) as res:\n" +
          '            return json.loads(res.read())["data"]\n\n' +
          methods + "\n",
      };
    }
    case "go": {
      const methods = REST_SURFACE.map((e) => {
        const ps = paramsOf(e).map((x) => x + " any");
        const args = ps.length ? ps.join(", ") + ", " : "";
        const bodyArg = e.method === "GET" ? "nil" : "body";
        const tok = e.path.includes("{token}") ? ' + token' : "";
        return "\nfunc (c *TemporalClient) " + pascal(e.name) + "(" + args + ") (map[string]any, error) {\n\treturn c.call(" + JSON.stringify(e.method) + ", " + JSON.stringify(e.path) + tok + ", " + bodyArg + ")\n}";
      }).join("\n");
      return {
        language: "go",
        filename: "omnimark_temporal.go",
        content:
          "// OmniMark Universal Temporal Platform SDK (generated)\npackage omnimark\n\n" +
          'import ("bytes"; "encoding/json"; "fmt"; "net/http")\n\n' +
          "type TemporalClient struct { BaseURL, APIKey string; HTTP *http.Client }\n\n" +
          "func (c *TemporalClient) call(method, path string, body any) (map[string]any, error) {\n" +
          "\tvar buf *bytes.Buffer\n" +
          "\tif body != nil { b, _ := json.Marshal(body); buf = bytes.NewBuffer(b) }\n" +
          "\tvar req *http.Request; var err error\n" +
          "\tif buf != nil { req, err = http.NewRequest(method, c.BaseURL+path, buf) } else { req, err = http.NewRequest(method, c.BaseURL+path, nil) }\n" +
          "\tif err != nil { return nil, err }\n" +
          '\treq.Header.Set("content-type", "application/json")\n' +
          '\treq.Header.Set("authorization", "Bearer "+c.APIKey)\n' +
          "\tres, err := c.HTTP.Do(req); if err != nil { return nil, err }; defer res.Body.Close()\n" +
          '\tif res.StatusCode >= 400 { return nil, fmt.Errorf("omnimark: %s", res.Status) }\n' +
          '\tvar out struct{ Data map[string]any `json:"data"` }; json.NewDecoder(res.Body).Decode(&out); return out.Data, nil\n' +
          "}" + methods + "\n",
      };
    }
    case "java": {
      const methods = REST_SURFACE.map((e) => {
        const ps = paramsOf(e).map((x) => (x === "body" ? "String body" : "String token"));
        const args = ps.length ? ps.join(", ") + ", " : "";
        const bodyArg = e.method === "GET" ? "null" : "body";
        return "  public String " + e.name + "(" + args + "String... ignored) throws Exception { return call(" + JSON.stringify(e.method) + ", " + JSON.stringify(e.path) + ", " + bodyArg + "); }";
      }).join("\n");
      return {
        language: "java",
        filename: "OmniMarkTemporalClient.java",
        content:
          "// OmniMark Universal Temporal Platform SDK (generated)\nimport java.net.http.*;\nimport java.net.URI;\n\n" +
          "public class OmniMarkTemporalClient {\n" +
          "  private final String baseUrl; private final String apiKey;\n" +
          "  private final HttpClient http = HttpClient.newHttpClient();\n" +
          "  public OmniMarkTemporalClient(String baseUrl, String apiKey) { this.baseUrl = baseUrl; this.apiKey = apiKey; }\n" +
          "  public String call(String method, String path, String body) throws Exception {\n" +
          "    var req = HttpRequest.newBuilder(URI.create(baseUrl + path))\n" +
          '      .header("content-type", "application/json").header("authorization", "Bearer " + apiKey)\n' +
          "      .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build();\n" +
          "    return http.send(req, HttpResponse.BodyHandlers.ofString()).body();\n" +
          "  }\n" + methods + "\n}\n",
      };
    }
    case "ruby": {
      const methods = REST_SURFACE.map((e) => {
        const ps = paramsOf(e);
        const sig = ps.length ? ps.join(", ") : "";
        const pass = e.method === "GET" ? "" : ", payload";
        const tok = e.path.includes("{token}") ? ", token" : "";
        return "  def " + snake(e.name) + "(" + sig + ") = call(" + JSON.stringify(e.method) + ", " + JSON.stringify(e.path) + pass + tok + ")";
      }).join("\n");
      return {
        language: "ruby",
        filename: "omnimark_temporal.rb",
        content:
          "# OmniMark Universal Temporal Platform SDK (generated)\n" +
          'require "json"; require "net/http"\n\n' +
          "class TemporalClient\n" +
          "  def initialize(base_url, api_key) = (@base_url, @api_key = base_url, api_key)\n" +
          "  def call(method, path, body = nil, token = nil)\n" +
          '    uri = URI(@base_url + (token ? path.gsub("{token}", token) : path))\n' +
          "    req = Net::HTTP.const_get(method.capitalize).new(uri)\n" +
          '    req["content-type"] = "application/json"; req["authorization"] = "Bearer #{@api_key}"\n' +
          "    req.body = JSON.generate(body) if body\n" +
          '    JSON.parse(Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https") { |h| h.request(req) }.body)["data"]\n' +
          "  end\n" + methods + "\nend\n",
      };
    }
    case "php": {
      const methods = REST_SURFACE.map((e) => {
        const ps = paramsOf(e).map((x) => (x === "body" ? "?array $body = null" : "?string $token = null"));
        const args = ps.length ? ps.join(", ") + ", " : "";
        const bodyArg = e.method === "GET" ? "null" : "$body";
        const tokArg = e.path.includes("{token}") ? ", $token" : "";
        return "  public function " + e.name + "(" + args + "): array { return $this->call(" + JSON.stringify(e.method) + ", " + JSON.stringify(e.path) + tokArg + ", " + bodyArg + "); }";
      }).join("\n");
      return {
        language: "php",
        filename: "OmniMarkTemporalClient.php",
        content:
          "<?php // OmniMark Universal Temporal Platform SDK (generated)\nclass OmniMarkTemporalClient {\n" +
          "  public function __construct(private string $baseUrl, private string $apiKey) {}\n" +
          "  public function call(string $method, string $path, ?array $body = null, ?string $token = null): array {\n" +
          '    $url = $this->baseUrl . ($token !== null ? str_replace("{token}", $token, $path) : $path);\n' +
          "    $ch = curl_init($url);\n" +
          "    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method,\n" +
          '      CURLOPT_HTTPHEADER => ["content-type: application/json", "authorization: Bearer " . $this->apiKey],\n' +
          "      CURLOPT_POSTFIELDS => $body === null ? null : json_encode($body)]);\n" +
          "    $json = json_decode(curl_exec($ch), true);\n" +
          '    return $json["data"] ?? [];\n' +
          "  }\n" + methods + "\n}\n",
      };
    }
    case "csharp": {
      const methods = REST_SURFACE.map((e) => {
        const ps = paramsOf(e).map((x) => (x === "body" ? "string body" : "string token"));
        const args = ps.length ? ps.join(", ") + ", " : "";
        const bodyArg = e.method === "GET" ? "null" : "body";
        const verb = e.method === "GET" ? "Get" : e.method === "POST" ? "Post" : e.method === "PATCH" ? "Patch" : "Delete";
        return "  public Task<string> " + pascal(e.name) + "Async(" + args + ') => CallAsync(HttpMethod.' + verb + ", " + JSON.stringify(e.path) + ", " + bodyArg + ");";
      }).join("\n");
      return {
        language: "csharp",
        filename: "OmniMarkTemporalClient.cs",
        content:
          "// OmniMark Universal Temporal Platform SDK (generated)\nusing System.Net.Http;\nusing System.Text;\n\n" +
          "public class OmniMarkTemporalClient {\n" +
          "  private readonly HttpClient _http = new(); private readonly string _baseUrl; private readonly string _apiKey;\n" +
          "  public OmniMarkTemporalClient(string baseUrl, string apiKey) { _baseUrl = baseUrl; _apiKey = apiKey; }\n" +
          "  public async Task<string> CallAsync(HttpMethod method, string path, string? body = null) {\n" +
          "    var req = new HttpRequestMessage(method, _baseUrl + path);\n" +
          '    req.Headers.Add("authorization", "Bearer " + _apiKey);\n' +
          '    if (body != null) req.Content = new StringContent(body, Encoding.UTF8, "application/json");\n' +
          "    var res = await _http.SendAsync(req); return await res.Content.ReadAsStringAsync();\n" +
          "  }\n" + methods + "\n}\n",
      };
    }
    case "curl":
    default: {
      const lines = REST_SURFACE.map((e) => {
        const body = e.method === "GET" ? "" : " -d '" + (e.body ?? "{}") + "'";
        return "# " + e.name + '\ncurl -s -X ' + e.method + ' "$BASE' + e.path + '" -H "authorization: Bearer $KEY" -H "content-type: application/json"' + body + "\n";
      }).join("\n");
      return {
        language: "curl",
        filename: "omnimark-temporal.sh",
        content:
          "#!/usr/bin/env bash\n" +
          "# OmniMark Universal Temporal Platform — cURL quickstart (generated)\n" +
          'BASE="${OMNIMARK_URL:-http://localhost:3000}"\n' +
          'KEY="${OMNIMARK_API_KEY:?set OMNIMARK_API_KEY}"\n' +
          "# API keys: Workspace → Settings → API keys\n\n" + lines,
      };
    }
  }
}

export function listSdkTargets() {
  return ["typescript", "python", "go", "java", "ruby", "php", "csharp", "curl"];
}

function snake(s: string) {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}
function pascal(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}