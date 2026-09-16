"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { toast } from "@/components/toast";
import { Plus } from "lucide-react";

type Net = {
  key: string;
  name: string;
  protocol: string;
  capabilities: string[];
  docsUrl: string | null;
  icon: string | null;
  appConfigured: boolean;
  connected: number;
  accounts: Array<{ id: string; handle: string; status: string }>;
};

export default function SocialPage() {
  const [rows, setRows] = useState<Net[]>([]);
  const [loading, setLoading] = useState(true);
  const [appFor, setAppFor] = useState<Net | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const [clients, setClients] = useState<Array<{ value: string; label: string }>>([]);
  const [clientIdForConnect, setClientIdForConnect] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.get<Net[]>("/social/networks")
      .then(setRows)
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    void load();
    api.get<{ rows: Array<{ id: string; name: string }> }>("/clients?pageSize=200")
      .then((r) => setClients(r.rows.map((c) => ({ value: c.id, label: c.name }))))
      .catch(() => {});
    if (new URLSearchParams(window.location.search).get("connected") === "1") {
      setJustConnected(true);
      window.history.replaceState(null, "", "/social");
    }
  }, [load]);

  async function connect(net: Net) {
    try {
      if (net.key === "demo") {
        await api.post("/social/demo-connect");
        toast("success", "Demo channel connected");
        load();
        return;
      }
      const r = await api.post<{ authorizeUrl: string }>("/social/connect", { connectorKey: net.key, clientId: clientIdForConnect || null });
      window.location.href = r.authorizeUrl;
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Social & media connectors"
        description="Platforms are data, not code — connect existing networks or add any future one."
        actions={
          <div className="flex gap-2">
            <Select className="w-52" value={clientIdForConnect} onChange={(e) => setClientIdForConnect(e.target.value)} options={[{ value: "", label: "Workspace account" }, ...clients]} />
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add platform</Button>
          </div>
        }
      />
      {justConnected && (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Social account connected ✓
        </div>
      )}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800/60" />)}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((net) => (
            <Card key={net.key} className="flex flex-col p-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">{net.icon ?? "🌐"}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{net.name}</p>
                  <p className="text-[11px] text-zinc-400">{net.protocol === "BUILTIN" ? "built-in adapter" : net.protocol === "OAUTH2_PKCE" ? "OAuth 2 · PKCE" : "OAuth 2"} · {net.capabilities.join(", ") || "—"}</p>
                </div>
              </div>
              <div className="mt-3 flex-1 space-y-1.5">
                {net.accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs dark:bg-zinc-800/40">
                    <span className="truncate">{a.handle}</span>
                    <Badge className={a.status === "CONNECTED" ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"}>{a.status.toLowerCase()}</Badge>
                  </div>
                ))}
                {!net.appConfigured && net.key !== "demo" && <p className="text-[11px] text-amber-600">⚠ app credentials not filled in</p>}
              </div>
              <div className="mt-3 flex gap-2">
                {net.key !== "demo" && (
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setAppFor(net)}>
                    {net.appConfigured ? "Edit app" : "Fill keys"}
                  </Button>
                )}
                <Button size="sm" className="flex-1" onClick={() => connect(net)} disabled={net.key !== "demo" && !net.appConfigured}>
                  Connect
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {appFor && <AppModal net={appFor} onClose={() => setAppFor(null)} onDone={load} />}
      {addOpen && <TemplateModal onClose={() => setAddOpen(false)} onDone={load} />}
    </div>
  );
}

function AppModal({ net, onClose, onDone }: { net: Net; onClose: () => void; onDone: () => void }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState("");
  const [adv, setAdv] = useState({ authorizeUrl: "", tokenUrl: "", apiBase: "", headers: "" });
  const [showAdv, setShowAdv] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`${net.name} — app credentials`}>
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          Create an app at the provider, set the OAuth redirect to <code className="rounded bg-zinc-100 px-1 text-[11px] dark:bg-zinc-800">{typeof window !== "undefined" ? window.location.origin : ""}/api/v1/social/callback</code>.
          {net.docsUrl && (
            <>
              {" "}
              <a className="text-sky-600 hover:underline" href={net.docsUrl} target="_blank" rel="noopener noreferrer">Setup docs ↗</a>
            </>
          )}
        </p>
        <Field label="App / client ID"><Input value={clientId} onChange={(e) => setClientId(e.target.value)} /></Field>
        <Field label="App / client secret"><Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} /></Field>
        <Field label="Scopes (comma separated)" hint="Empty = connector defaults"><Input value={scopes} onChange={(e) => setScopes(e.target.value)} /></Field>
        <button onClick={() => setShowAdv((v) => !v)} className="text-xs font-medium text-zinc-500 hover:underline">{showAdv ? "Hide" : "Show"} endpoint overrides</button>
        {showAdv && (
          <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <Field label="Authorize URL override"><Input value={adv.authorizeUrl} onChange={(e) => setAdv({ ...adv, authorizeUrl: e.target.value })} /></Field>
            <Field label="Token URL override"><Input value={adv.tokenUrl} onChange={(e) => setAdv({ ...adv, tokenUrl: e.target.value })} /></Field>
            <Field label="API base override"><Input value={adv.apiBase} onChange={(e) => setAdv({ ...adv, apiBase: e.target.value })} /></Field>
            <Field label='Extra headers (JSON)'><Input value={adv.headers} onChange={(e) => setAdv({ ...adv, headers: e.target.value })} placeholder='{"LinkedIn-Version":"202506"}' /></Field>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              let headers: Record<string, string> | null = null;
              if (adv.headers.trim()) {
                try { headers = JSON.parse(adv.headers) as Record<string, string>; } catch { toast("error", "Extra headers must be valid JSON"); setBusy(false); return; }
              }
              await api.post("/social/apps", {
                connectorKey: net.key,
                clientId,
                clientSecret,
                scopes: scopes.split(",").map((x) => x.trim()).filter(Boolean),
                authorizeUrl: adv.authorizeUrl || null,
                tokenUrl: adv.tokenUrl || null,
                apiBase: adv.apiBase || null,
                headers,
              });
              toast("success", "App configured");
              onDone();
              onClose();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

const BLANK_TEMPLATE = `{
  "me": { "path": "/api/v1/accounts/verify_credentials", "idPath": "id", "handlePath": "username", "namePath": "display_name", "picturePath": "avatar" },
  "publish": { "path": "/api/v1/statuses", "body": { "status": "{{text}}" }, "idPath": "id", "urlPath": "url" },
  "accessTokenPath": "access_token",
  "refreshTokenPath": "refresh_token",
  "expiresInPath": "expires_in"
}`;

function TemplateModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ key: "", name: "", protocol: "OAUTH2_CODE", authorizeUrl: "", tokenUrl: "", apiBase: "", scopes: "", capabilities: "publish", docsUrl: "", config: BLANK_TEMPLATE });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Add a platform (connector template)" wide>
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          Any OAuth2 + JSON-API platform (Mastodon instances, Threads, niche networks) plugs in here — endpoints and
          field mappings are data; no deployment needed.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Key" hint="lowercase, e.g. mastodon"><Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase() })} /></Field>
          <Field label="Display name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Protocol"><Select value={f.protocol} onChange={(e) => setF({ ...f, protocol: e.target.value })} options={[{ value: "OAUTH2_CODE", label: "OAuth 2.0" }, { value: "OAUTH2_PKCE", label: "OAuth 2.0 + PKCE" }, { value: "BUILTIN", label: "Built-in adapter (platform-owned)" }]} /></Field>
          <Field label="Capabilities"><Input value={f.capabilities} onChange={(e) => setF({ ...f, capabilities: e.target.value })} placeholder="publish, read_metrics" /></Field>
          <Field label="Authorize URL"><Input value={f.authorizeUrl} onChange={(e) => setF({ ...f, authorizeUrl: e.target.value })} placeholder="https://…/oauth/authorize" /></Field>
          <Field label="Token URL"><Input value={f.tokenUrl} onChange={(e) => setF({ ...f, tokenUrl: e.target.value })} placeholder="https://…/oauth/token" /></Field>
          <Field label="API base"><Input value={f.apiBase} onChange={(e) => setF({ ...f, apiBase: e.target.value })} placeholder="https://…/api" /></Field>
          <Field label="Default scopes"><Input value={f.scopes} onChange={(e) => setF({ ...f, scopes: e.target.value })} placeholder="read, write" /></Field>
          <Field label="Setup docs URL" className="col-span-2"><Input value={f.docsUrl} onChange={(e) => setF({ ...f, docsUrl: e.target.value })} /></Field>
        </div>
        <Field label="Connector config (endpoints + response mappings)" hint="JSON — {{text}}, {{linkUrl}}, {{token}} placeholders supported">
          <Textarea rows={10} className="font-mono text-xs" value={f.config} onChange={(e) => setF({ ...f, config: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            let config: Record<string, unknown>;
            try { config = JSON.parse(f.config) as Record<string, unknown>; } catch { toast("error", "Config must be valid JSON"); return; }
            setBusy(true);
            try {
              await api.post("/social/templates", {
                key: f.key,
                name: f.name,
                protocol: f.protocol,
                authorizeUrl: f.authorizeUrl || null,
                tokenUrl: f.tokenUrl || null,
                apiBase: f.apiBase || null,
                scopes: f.scopes.split(",").map((x) => x.trim()).filter(Boolean),
                capabilities: f.capabilities.split(",").map((x) => x.trim()).filter(Boolean),
                docsUrl: f.docsUrl || null,
                config,
              });
              toast("success", "Platform added");
              onDone();
              onClose();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Add platform</Button>
        </div>
      </div>
    </Modal>
  );
}
