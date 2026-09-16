"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td, Badge } from "@/components/ui";
import { CrudFormModal, type FieldDef } from "@/components/crud";
import { fmtDate } from "@/lib/format";
import { toast } from "@/components/toast";
import { cn } from "@/lib/utils";
import { KeyRound } from "lucide-react";

type Org = Record<string, string | null>;
type TaxRate = { id: string; code: string; name: string; kind: string; rateBps: number; active: boolean; components: Array<{ id: string; code: string; rateBps: number }> };
type Seq = { id: string; kind: string; pattern: string; prefix: string; padding: number; nextValue: number };
type Category = { id: string; code: string; name: string; kind: string; sortOrder: number; active: boolean };
type Gateway = { id: string; providerCode: string; scope: string; mode: string; label: string; active: boolean; publicMeta: { keyId?: string } | null };
type ApiKey = { id: string; name: string; prefix: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string };

const TABS = ["Organization", "Numbering", "Tax rates", "Categories", "Payments", "AI Studio", "API keys", "Security"] as const;

type ReadyItem = { key: string; label: string; state: "ok" | "warn" | "missing"; detail: string; action?: string };

export function SettingsClient({
  org,
  permissions,
  canManagePlatform,
}: {
  org: Org;
  permissions: string[];
  canManagePlatform: boolean;
  activeCurrency: string;
  hasSubscription: boolean;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Organization");
  const [ready, setReady] = useState<{ score: number; items: ReadyItem[] } | null>(null);
  const [showReady, setShowReady] = useState(false);
  useEffect(() => {
    api.get<{ score: number; items: ReadyItem[] }>("/settings/readiness").then(setReady).catch(() => {});
  }, []);
  const canManage = permissions.includes("settings.manage");
  return (
    <div>
      <PageHeader title="Settings" description="Configuration for your workspace — all data-driven." />
      {ready && (
        <button
          onClick={() => setShowReady((v) => !v)}
          className={`mb-3 flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
            ready.score >= 90
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : ready.score >= 60
                ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          }`}
        >
          <span>
            <span className="text-sm font-semibold">Production readiness: {ready.score}%</span>
            <span className="ml-2 text-xs opacity-80">{ready.items.filter((i) => i.state !== "ok").length} external blank(s) awaiting fill-in</span>
          </span>
          <span className="text-xs underline">{showReady ? "hide" : "show checklist"}</span>
        </button>
      )}
      {ready && showReady && (
        <Card className="mb-4">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {ready.items.map((i) => (
              <li key={i.key} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
                <div>
                  <p className="font-medium">{i.label}</p>
                  <p className="text-xs text-zinc-500">{i.detail}</p>
                  {i.action && <p className="text-[11px] text-zinc-400">→ {i.action}</p>}
                </div>
                <Badge className={i.state === "ok" ? "bg-emerald-500/15 text-emerald-600" : i.state === "warn" ? "bg-amber-500/15 text-amber-600" : "bg-red-500/15 text-red-600"}>{i.state}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab === t ? "border-zinc-900 text-zinc-900 dark:border-white dark:text-white" : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Organization" && <OrgPanel org={org} canManage={permissions.includes("org.update")} />}
      {tab === "Numbering" && <NumberingPanel canManage={canManage} />}
      {tab === "Tax rates" && <TaxPanel canManage={canManage} />}
      {tab === "Categories" && <CategoriesPanel canManage={canManage} />}
      {tab === "Payments" && <GatewaysPanel canManage={canManage} canManagePlatform={canManagePlatform} />}
      {tab === "AI Studio" && <AiPanel canManage={canManage} canManagePlatform={canManagePlatform} />}
      {tab === "Security" && <SecurityPanel />}
      {tab === "API keys" && <ApiKeysPanel canManage={permissions.includes("apikey.manage")} canRead={permissions.includes("apikey.read")} />}
    </div>
  );
}

// --- Organization -------------------------------------------------------
function OrgPanel({ org, canManage }: { org: Org; canManage: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState(org);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((c) => ({ ...c, [k]: v }));
  const input = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  return (
    <Card>
      <CardHeader title="Organization profile" description="Appears on invoices and reports." />
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <Field label="Name"><Input value={form.name ?? ""} disabled={!canManage} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Workspace URL"><div className={cn(input, "bg-zinc-50 text-zinc-500")}>omnimark/{org.slug}</div></Field>
        <Field label="Email"><Input value={form.email ?? ""} disabled={!canManage} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Billing email"><Input value={form.billingEmail ?? ""} disabled={!canManage} onChange={(e) => set("billingEmail", e.target.value)} /></Field>
        <Field label="Phone"><Input value={form.phone ?? ""} disabled={!canManage} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Website"><Input value={form.website ?? ""} disabled={!canManage} onChange={(e) => set("website", e.target.value)} /></Field>
        <Field label="GSTIN"><Input value={form.gstin ?? ""} disabled={!canManage} onChange={(e) => set("gstin", e.target.value)} /></Field>
        <Field label="Timezone"><Input value={form.timezone ?? ""} disabled={!canManage} onChange={(e) => set("timezone", e.target.value)} /></Field>
        <Field label="Address line 1"><Input value={form.addressLine1 ?? ""} disabled={!canManage} onChange={(e) => set("addressLine1", e.target.value)} /></Field>
        <Field label="City"><Input value={form.city ?? ""} disabled={!canManage} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label="State" hint="Drives GST intra/inter"><Input value={form.state ?? ""} disabled={!canManage} onChange={(e) => set("state", e.target.value)} /></Field>
        <Field label="Country"><Input value={form.country ?? ""} disabled={!canManage} onChange={(e) => set("country", e.target.value)} /></Field>
      </div>
      {canManage && (
        <div className="flex justify-end border-t border-zinc-100 p-4 dark:border-zinc-800">
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.patch("/settings/org", {
                name: form.name, email: form.email || null, billingEmail: form.billingEmail || null,
                phone: form.phone || null, website: form.website || null, gstin: form.gstin || null,
                timezone: form.timezone, addressLine1: form.addressLine1 || null, city: form.city || null,
                state: form.state || null, country: form.country,
              });
              toast("success", "Saved");
              router.refresh();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}>Save changes</Button>
        </div>
      )}
    </Card>
  );
}

// --- Numbering ----------------------------------------------------------
function NumberingPanel({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<Seq[]>([]);
  const [editing, setEditing] = useState<Seq | null>(null);
  const load = useCallback(() => api.get<Seq[]>("/settings/sequences").then(setRows).catch((e) => toast("error", e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const fields: FieldDef[] = [
    { name: "prefix", label: "Prefix", required: true, half: true },
    { name: "padding", label: "Sequence digits", kind: "number", required: true, half: true },
    { name: "pattern", label: "Pattern", required: true, hint: "Tokens: {PREFIX} {YEAR} {MONTH} {SEQ}" },
  ];
  return (
    <Card>
      <CardHeader title="Document numbering" description="How quotes, invoices and receipts are numbered." />
      <TWrap>
        <thead><tr><Th>Type</Th><Th>Pattern</Th><Th>Next</Th><Th className="text-right"></Th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <Td className="font-medium capitalize">{s.kind.toLowerCase()}</Td>
              <Td className="font-mono text-xs text-zinc-500">{s.prefix}-{s.pattern.replace("{PREFIX}-", "").replace("{PREFIX}", "")}</Td>
              <Td className="text-zinc-500">{String(s.nextValue).padStart(s.padding, "0")}</Td>
              <Td className="text-right">{canManage && <button onClick={() => setEditing(s)} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Edit</button>}</Td>
            </tr>
          ))}
        </tbody>
      </TWrap>
      {editing && (
        <CrudFormModal open onClose={() => setEditing(null)} title={`Edit ${editing.kind.toLowerCase()} numbering`} fields={fields}
          initial={{ prefix: editing.prefix, padding: editing.padding, pattern: editing.pattern }}
          onSubmit={async (p) => { await api.patch(`/settings/sequences/${editing.id}`, p); setEditing(null); load(); }} />
      )}
    </Card>
  );
}

// --- Tax rates ----------------------------------------------------------
function TaxPanel({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<TaxRate[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api.get<TaxRate[]>("/settings/tax-rates").then(setRows).catch((e) => toast("error", e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const fields: FieldDef[] = [
    { name: "code", label: "Code", required: true, half: true },
    { name: "name", label: "Name", required: true, half: true },
    { name: "rate", label: "Rate %", kind: "number", required: true, half: true },
    { name: "kind", label: "Type", kind: "select", required: true, half: true, options: [
      { value: "GST_INTRA", label: "GST (intra-state CGST+SGST)" },
      { value: "GST_INTER", label: "GST (inter-state IGST)" },
      { value: "FLAT", label: "Flat tax" },
    ] },
  ];
  return (
    <Card>
      <CardHeader title="Tax rates" description="GST & other tax groups with auto-derived components." actions={canManage && <Button size="sm" onClick={() => setOpen(true)}>Add rate</Button>} />
      <TWrap>
        <thead><tr><Th>Code</Th><Th>Name</Th><Th>Rate</Th><Th>Components</Th><Th>Status</Th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <Td className="font-mono text-xs">{t.code}</Td>
              <Td>{t.name}</Td>
              <Td className="tabular-nums">{t.rateBps / 100}%</Td>
              <Td className="text-xs text-zinc-500">{t.components.length ? t.components.map((c) => `${c.code.split("-").pop()} ${c.rateBps / 100}%`).join(" + ") : "—"}</Td>
              <Td><Badge className={t.active ? "bg-emerald-500/15 text-emerald-600" : "bg-zinc-500/15 text-zinc-500"}>{t.active ? "active" : "off"}</Badge></Td>
            </tr>
          ))}
        </tbody>
      </TWrap>
      {open && <CrudFormModal open onClose={() => setOpen(false)} title="New tax rate" fields={fields} onSubmit={async (p) => { await api.post("/settings/tax-rates", { ...p, rateBps: Math.round(Number(p.rate) * 100) }); setOpen(false); load(); }} />}
    </Card>
  );
}

// --- Categories ---------------------------------------------------------
const KINDS = ["SERVICE", "INDUSTRY", "LEAD_SOURCE", "EXPENSE_TYPE", "CAMPAIGN_CHANNEL", "PROJECT_TYPE"];
function CategoriesPanel({ canManage }: { canManage: boolean }) {
  const [kind, setKind] = useState(KINDS[0]);
  const [rows, setRows] = useState<Category[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api.get<Category[]>(`/settings/categories?kind=${kind}`).then(setRows).catch((e) => toast("error", e.message)), [kind]);
  useEffect(() => { void load(); }, [load]);
  const fields: FieldDef[] = [
    { name: "code", label: "Code", required: true, half: true },
    { name: "name", label: "Name", required: true, half: true },
    { name: "sortOrder", label: "Sort order", kind: "number", default: 0, half: true },
  ];
  return (
    <Card>
      <CardHeader title="Categories" description="Reference lists used across the app." actions={canManage && <Button size="sm" onClick={() => setOpen(true)}>Add</Button>} />
      <div className="px-4 pb-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} options={KINDS.map((k) => ({ value: k, label: k.replace("_", " ").toLowerCase() }))} className="w-56" />
      </div>
      <TWrap>
        <thead><tr><Th>Code</Th><Th>Name</Th><Th>Scope</Th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <Td className="font-mono text-xs">{c.code}</Td>
              <Td>{c.name}</Td>
              <Td>{c.id ? <Badge className="bg-zinc-500/10 text-zinc-500">{c.active ? "active" : "off"}</Badge> : null}</Td>
            </tr>
          ))}
        </tbody>
      </TWrap>
      {open && <CrudFormModal open onClose={() => setOpen(false)} title={`New ${kind.toLowerCase()} category`} fields={fields} onSubmit={async (p) => { await api.post("/settings/categories", { ...p, kind }); setOpen(false); load(); }} />}
    </Card>
  );
}

// --- Gateways -----------------------------------------------------------
function GatewaysPanel({ canManage, canManagePlatform }: { canManage: boolean; canManagePlatform: boolean }) {
  const [rows, setRows] = useState<Gateway[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api.get<Gateway[]>("/settings/gateways").then(setRows).catch((e) => toast("error", e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const fields: FieldDef[] = [
    { name: "providerCode", label: "Provider", kind: "select", required: true, half: true, options: [{ value: "razorpay", label: "Razorpay" }, { value: "stripe", label: "Stripe" }, { value: "mock", label: "Mock (sandbox)" }] },
    { name: "scope", label: "Scope", kind: "select", required: true, half: true, options: [{ value: "ORGANIZATION", label: "Collect from clients" }, ...(canManagePlatform ? [{ value: "PLATFORM", label: "Platform (billing)" }] : [])] },
    { name: "mode", label: "Mode", kind: "select", required: true, default: "SANDBOX", half: true, options: [{ value: "SANDBOX", label: "Sandbox" }, { value: "LIVE", label: "Live" }] },
    { name: "label", label: "Label", required: true, half: true },
    { name: "keyId", label: "Key ID", required: true, hint: "Razorpay key id / Stripe publishable" },
    { name: "keySecret", label: "Secret", required: true, kind: "password", hint: "Encrypted at rest (AES-256-GCM)" },
    { name: "webhookSecret", label: "Webhook signing secret" },
  ];
  return (
    <div>
      <Card className="mb-4">
        <CardHeader title="Payment gateways" description="Plug in a provider to collect online. Secrets are envelope-encrypted at rest." actions={canManage && <Button size="sm" onClick={() => setOpen(true)}>Configure</Button>} />
        {rows.length === 0 ? (
          <div className="p-4 text-sm text-zinc-400">No gateways configured. Use the Mock provider to try online collection.</div>
        ) : (
          <TWrap>
            <thead><tr><Th>Provider</Th><Th>Scope</Th><Th>Mode</Th><Th>Status</Th><Th className="text-right"></Th></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <Td><p className="font-medium capitalize">{g.providerCode}</p><p className="text-xs text-zinc-400">{g.label}</p></Td>
                  <Td className="text-zinc-500">{g.scope === "PLATFORM" ? "Platform" : "This workspace"}</Td>
                  <Td><Badge className="bg-zinc-500/10 text-zinc-500">{g.mode.toLowerCase()}</Badge></Td>
                  <Td><Badge className={g.active ? "bg-emerald-500/15 text-emerald-600" : "bg-zinc-500/15 text-zinc-500"}>{g.active ? "active" : "inactive"}</Badge></Td>
                  <Td className="text-right">
                    {canManage && !g.active && <button onClick={async () => { try { await api.post(`/settings/gateways/${g.id}/activate`); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Activate</button>}
                    {canManage && g.active && <button onClick={async () => { try { await api.post(`/settings/gateways/${g.id}/deactivate`); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Deactivate</button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>
      <Card>
        <CardHeader title="Webhook endpoints" description="Point provider dashboards here to auto-reconcile payments." />
        <div className="space-y-2 p-4 text-sm">
          <WebhookRow url="/api/v1/webhooks/razorpay" />
          <WebhookRow url="/api/v1/webhooks/stripe" />
        </div>
      </Card>
      {open && <CrudFormModal open onClose={() => setOpen(false)} title="Configure gateway" fields={fields} onSubmit={async (p) => { await api.post("/settings/gateways", { ...p, webhookSecret: p.webhookSecret || null }); setOpen(false); load(); }} />}
    </div>
  );
}

function WebhookRow({ url }: { url: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/40">
      <code className="text-xs text-zinc-600 dark:text-zinc-300">{typeof window !== "undefined" ? window.location.origin + url : url}</code>
      <button onClick={() => navigator.clipboard?.writeText((typeof window !== "undefined" ? window.location.origin : "") + url).then(() => toast("success", "Copied"))} className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Copy</button>
    </div>
  );
}

// --- API keys -----------------------------------------------------------
function ApiKeysPanel({ canManage, canRead }: { canManage: boolean; canRead: boolean }) {
  const [rows, setRows] = useState<ApiKey[]>([]);
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const load = useCallback(() => { if (canRead) api.get<ApiKey[]>("/apikeys").then(setRows).catch((e) => toast("error", e.message)); }, [canRead]);
  useEffect(load, [load]);
  const fields: FieldDef[] = [
    { name: "name", label: "Name", required: true, half: true },
    { name: "expiresInDays", label: "Valid for (days)", kind: "number", default: 90, half: true },
  ];
  if (!canRead) return <Card><div className="p-4 text-sm text-zinc-400">You don&apos;t have permission to view API keys.</div></Card>;
  return (
    <Card>
      <CardHeader title="API keys" description="Server-to-server access with scoped permissions." actions={canManage && <Button size="sm" onClick={() => setOpen(true)}><KeyRound className="h-3.5 w-3.5" /> Create key</Button>} />
      <TWrap>
        <thead><tr><Th>Name</Th><Th>Prefix</Th><Th>Created</Th><Th>Last used</Th><Th>Status</Th></tr></thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k.id}>
              <Td className="font-medium">{k.name}</Td>
              <Td className="font-mono text-xs">{k.prefix}…</Td>
              <Td className="text-zinc-500">{fmtDate(k.createdAt)}</Td>
              <Td className="text-zinc-500">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : "never"}</Td>
              <Td><Badge className={k.revokedAt ? "bg-red-500/15 text-red-600" : "bg-emerald-500/15 text-emerald-600"}>{k.revokedAt ? "revoked" : "active"}</Badge></Td>
            </tr>
          ))}
        </tbody>
      </TWrap>
      {secret && (
        <Modal open onClose={() => setSecret(null)} title="Copy your API key">
          <p className="mb-3 text-sm text-zinc-500">This is the only time the secret is shown. Store it securely.</p>
          <div className="flex items-center gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/40">
            <code className="flex-1 break-all text-xs">{secret}</code>
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(secret).then(() => toast("success", "Copied"))}>Copy</Button>
          </div>
        </Modal>
      )}
      {open && <CrudFormModal open onClose={() => setOpen(false)} title="Create API key" fields={fields} onSubmit={async (p) => { const res = await api.post<{ secret: string }>("/apikeys", { ...p, scopes: [] }); setSecret(res.secret); setOpen(false); load(); }} />}
    </Card>
  );
}

// --- AI Studio ------------------------------------------------------------
type AiCfg = { id: string; providerCode: string; label: string; baseUrl: string | null; textModel: string; imageModel: string; audioModel: string; defaultVoice: string; priority: number; requiredFeature: string | null; active: boolean; orgId: string | null; updatedAt: string };
type RoutingRow = { id: string; providerCode: string; label: string; scope: string; priority: number; requiredFeature: string | null; model: string; eligible: boolean; reason: string | null };
type Template = { id: string; key: string; kind: string; title: string; body: string; orgId: string | null; active: boolean; version: number };
type Voice = { id: string; name: string; tone: string; audience: string; vocabularyDo: string[]; vocabularyDont: string[]; bannedClaims: string | null; isDefault: boolean; client: { name: string } | null };

function AiPanel({ canManage, canManagePlatform }: { canManage: boolean; canManagePlatform: boolean }) {
  const [cfgs, setCfgs] = useState<AiCfg[]>([]);
  const [routing, setRouting] = useState<RoutingRow[]>([]);
  const [planFeatures, setPlanFeatures] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [open, setOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [tmplFor, setTmplFor] = useState<Template | null>(null);

  const load = useCallback(() => {
    api.get<AiCfg[]>("/studio/configs").then((r) => setCfgs([...r].sort((a, b) => a.priority - b.priority))).catch(() => {});
    api.get<{ rows: RoutingRow[] }>("/studio/routing").then((r) => setRouting(r.rows)).catch(() => {});
    api.get<string[]>("/settings/plan-features").then(setPlanFeatures).catch(() => {});
    api.get<Template[]>("/studio/templates").then(setTemplates).catch(() => {});
    api.get<Voice[]>("/studio/voices").then(setVoices).catch(() => {});
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="AI providers" description="OpenAI-compatible or Anthropic keys — encrypted at rest. The Demo engine works with no keys." actions={canManage && <Button size="sm" onClick={() => setOpen(true)}>Configure provider</Button>} />
        <TWrap>
          <thead><tr><Th>Provider</Th><Th>Models</Th><Th>Scope</Th><Th>Status</Th><Th className="text-right"></Th></tr></thead>
          <tbody>
            {cfgs.map((c) => (
              <tr key={c.id}>
                <Td><p className="font-medium capitalize">{c.providerCode}</p><p className="text-xs text-zinc-400">{c.label}</p></Td>
                <Td className="font-mono text-xs text-zinc-500">{c.textModel}</Td>
                <Td className="text-zinc-500">{c.orgId ? "This workspace" : "Platform"}</Td>
                <Td><Badge className={c.active ? "bg-emerald-500/15 text-emerald-600" : "bg-zinc-500/10 text-zinc-500"}>{c.active ? "active" : "inactive"}</Badge></Td>
                <Td className="text-right">
                  {canManage && (
                    <button
                      onClick={async () => {
                        try { await api.post(`/studio/configs/${c.id}/activate`, { active: !c.active }); load(); }
                        catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
                      }}
                      className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      {c.active ? "Deactivate" : "Activate"}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
            {cfgs.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-400">No providers configured</td></tr>}
          </tbody>
        </TWrap>
      </Card>

      <Card>
        <CardHeader title="AI routing order" description="Attempted top-to-bottom: free engines first, premium gated by plan features, fallback last" />
        <TWrap>
          <thead><tr><Th>Priority</Th><Th>Provider</Th><Th>Model</Th><Th>Scope</Th><Th>Gate</Th><Th>Status</Th></tr></thead>
          <tbody>
            {routing.map((row) => (
              <tr key={row.id}>
                <Td className="tabular-nums text-zinc-500">{row.priority}</Td>
                <Td><p className="font-medium">{row.label}</p><p className="text-xs text-zinc-400">{row.scope.toLowerCase()}</p></Td>
                <Td className="font-mono text-xs text-zinc-500">{row.model || "—"}</Td>
                <Td className="text-zinc-500">{row.scope === "ORGANIZATION" ? "this workspace" : "platform"}</Td>
                <Td>{row.requiredFeature ? <Badge className="bg-violet-500/10 text-violet-600">{row.requiredFeature}</Badge> : <span className="text-xs text-zinc-400">free</span>}</Td>
                <Td>{row.eligible ? <Badge className="bg-emerald-500/15 text-emerald-600">eligible</Badge> : <span className="text-xs text-zinc-400" title={row.reason ?? ""}>{row.reason ?? "skipped"}</span>}</Td>
              </tr>
            ))}
            {routing.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-zinc-400">No eligible provider for text generation</td></tr>}
          </tbody>
        </TWrap>
      </Card>

      <Card>
        <CardHeader title="Brand voices" description="Tone, audience and guardrails injected into every generation" actions={<Button size="sm" onClick={() => setVoiceOpen(true)}>New voice</Button>} />
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {voices.map((v) => (
            <li key={v.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{v.name} {v.isDefault && <Badge className="ml-1 bg-violet-500/10 text-violet-600">default</Badge>}</p>
                <p className="text-xs text-zinc-500">{v.tone} · {v.audience}</p>
              </div>
              <div className="flex items-center gap-2">
                {v.client && <Badge className="bg-zinc-500/10 text-zinc-500">{v.client.name}</Badge>}
                <button onClick={async () => { try { await api.del(`/studio/voices/${v.id}`); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Delete</button>
              </div>
            </li>
          ))}
          {voices.length === 0 && <li className="px-4 py-8 text-center text-sm text-zinc-400">No brand voices yet — add one for sharper output</li>}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Prompt templates" description="Versioned DB-driven prompts ({{topic}}, {{keywords}}, …)" />
        <TWrap>
          <thead><tr><Th>Key</Th><Th>Title</Th><Th>Kind</Th><Th>Scope</Th><Th>Version</Th><Th className="text-right"></Th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <Td className="font-mono text-xs">{t.key}</Td>
                <Td>{t.title}</Td>
                <Td className="text-zinc-500">{t.kind.toLowerCase().replace(/_/g, " ")}</Td>
                <Td className="text-zinc-500">{t.orgId ? "workspace override" : "global"}</Td>
                <Td className="text-zinc-500">v{t.version}</Td>
                <Td className="text-right">
                  <button onClick={() => setTmplFor(t)} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">View</button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TWrap>
      </Card>

      {open && <AiConfigModal canManagePlatform={canManagePlatform} planFeatures={planFeatures} onClose={() => setOpen(false)} onDone={load} />}
      {voiceOpen && <VoiceModal onClose={() => setVoiceOpen(false)} onDone={load} />}
      {tmplFor && (
        <Modal open onClose={() => setTmplFor(null)} title={`${tmplFor.key} (v${tmplFor.version})`} wide>
          <p className="mb-2 text-xs text-zinc-500">{tmplFor.title}</p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 font-mono text-xs dark:bg-zinc-800/40">{tmplFor.body}</pre>
        </Modal>
      )}
    </div>
  );
}

function AiConfigModal({ canManagePlatform, planFeatures, onClose, onDone }: { canManagePlatform: boolean; planFeatures: string[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ providerCode: "demo", label: "Demo engine", apiKey: "demo-key", baseUrl: "", textModel: "gpt-4o-mini", scope: "ORGANIZATION", priority: "100", gate: "" });
  const [busy, setBusy] = useState(false);
  const demo = f.providerCode === "demo";
  return (
    <Modal open onClose={onClose} title="Configure AI provider">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Provider">
            <Select value={f.providerCode} onChange={(e) => setF({ ...f, providerCode: e.target.value, label: e.target.value === "demo" ? "Demo engine" : e.target.value === "openai" ? "OpenAI" : "Anthropic", apiKey: e.target.value === "demo" ? "demo-key" : f.apiKey })} options={[
              { value: "demo", label: "Demo (offline)" },
              { value: "openai", label: "OpenAI / compatible (also Groq, OpenRouter…)" },
              { value: "anthropic", label: "Anthropic Claude" },
              { value: "google", label: "Google Gemini" },
            ]} />
          </Field>
          <Field label="Scope">
            <Select value={f.scope} disabled={!canManagePlatform} onChange={(e) => setF({ ...f, scope: e.target.value })} options={[
              { value: "ORGANIZATION", label: "This workspace" },
              ...(canManagePlatform ? [{ value: "PLATFORM" as const, label: "Platform default" }] : []),
            ]} />
          </Field>
        </div>
        <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
        {!demo && <Field label="Base URL (optional)" hint="e.g. an OpenAI-compatible proxy"><Input value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} /></Field>}
        <Field label={demo ? "Placeholder key" : "API key"} hint="Envelope-encrypted with AES-256-GCM before storage">
          <Input type="password" value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} />
        </Field>
        <Field label="Text model"><Input value={f.textModel} onChange={(e) => setF({ ...f, textModel: e.target.value })} disabled={demo} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Routing priority" hint="Lower = tried first"><Input type="number" min={1} max={1000} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></Field>
          <Field label="Plan gate" hint="Empty = free for every plan">
            <Select value={f.gate} onChange={(e) => setF({ ...f, gate: e.target.value })} options={[{ value: "", label: "No plan requirement" }, ...planFeatures.map((pf) => ({ value: pf, label: pf }))]} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/studio/configs", {
                providerCode: f.providerCode,
                label: f.label,
                apiKey: f.apiKey,
                baseUrl: f.baseUrl || null,
                textModel: f.textModel || "gpt-4o-mini",
                scope: f.scope,
                priority: Number(f.priority) || 100,
                requiredFeature: f.gate || null,
              });
              toast("success", "Saved — activate it in the list");
              onDone(); onClose();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function VoiceModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", tone: "", audience: "", do: "", dont: "", banned: "", isDefault: false });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="New brand voice">
      <div className="space-y-3">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. AIthink house style" /></Field>
        <Field label="Tone"><Input value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} placeholder="confident, plain-spoken, zero jargon" /></Field>
        <Field label="Audience"><Input value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} placeholder="Indian D2C founders, 25-40" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Preferred words"><Input value={f.do} onChange={(e) => setF({ ...f, do: e.target.value })} placeholder="results, systems, proof" /></Field>
          <Field label="Avoid words"><Input value={f.dont} onChange={(e) => setF({ ...f, dont: e.target.value })} placeholder="synergy, game-changer" /></Field>
        </div>
        <Field label="Never claim" hint="Compliance guardrails injected into prompts"><Input value={f.banned} onChange={(e) => setF({ ...f, banned: e.target.value })} placeholder="no income guarantees, no cure claims" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} className="h-4 w-4" />Default voice for this workspace</label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/studio/voices", {
                name: f.name,
                tone: f.tone,
                audience: f.audience,
                vocabularyDo: f.do.split(",").map((x) => x.trim()).filter(Boolean),
                vocabularyDont: f.dont.split(",").map((x) => x.trim()).filter(Boolean),
                bannedClaims: f.banned || null,
                isDefault: f.isDefault,
              });
              toast("success", "Brand voice saved");
              onDone(); onClose();
            } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); setBusy(false); }
          }}>Save voice</Button>
        </div>
      </div>
    </Modal>
  );
}

// --- Security (password / sessions / 2FA) ------------------------------------
type Sess = { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string };

function SecurityPanel() {
  const router = useRouter();
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [totpUrl, setTotpUrl] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [totpOn, setTotpOn] = useState(false);
  const [pwOn, setPwOn] = useState("");

  const load = useCallback(() => {
    api.get<Sess[]>("/auth/sessions").then(setSessions).catch(() => {});
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Password" description="Changing it revokes every active session" />
        <div className="grid grid-cols-2 gap-3 p-4">
          <Field label="Current password"><Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="New password" hint="10+ chars, mixed case, digit, symbol"><Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <div className="col-span-2">
            <Button loading={pwBusy} onClick={async () => {
              setPwBusy(true);
              try {
                await api.post("/auth/change-password", pw);
                toast("success", "Password changed — sign in again");
                router.push("/login");
              } catch (e) {
                toast("error", e instanceof Error ? e.message : "Failed");
                setPwBusy(false);
              }
            }}>Change password</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Two-factor authentication (TOTP)"
          description="Works with Google Authenticator, Authy, 1Password… Recovery codes are single-use"
          actions={totpOn ? (
            <Button size="sm" variant="outline" onClick={async () => {
              const password = window.prompt("Confirm your password to disable 2FA:");
              if (!password) return;
              try { await api.post("/auth/totp/disable", { password }); setTotpOn(false); setTotpUrl(null); toast("success", "2FA disabled"); }
              catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
            }}>Disable</Button>
          ) : undefined}
        />
        <div className="space-y-3 p-4">
          {!totpOn && !totpUrl && (
            <Button size="sm" onClick={async () => {
              try {
                const r = await api.post<{ otpauthUrl: string }>("/auth/totp/begin");
                setTotpUrl(r.otpauthUrl);
              } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
            }}>Set up 2FA</Button>
          )}
          {!totpOn && totpUrl && (
            <>
              <p className="text-xs text-zinc-500">Add this setup key to your authenticator app, then confirm with the current code:</p>
              <code className="block break-all rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/40">{totpUrl}</code>
              <div className="flex gap-2">
                <Input placeholder="123456" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} className="w-32" />
                <Button loading={pwBusy} onClick={async () => {
                  setPwBusy(true);
                  try {
                    const r = await api.post<{ recoveryCodes: string[] }>("/auth/totp/confirm", { code: totpCode });
                    setRecovery(r.recoveryCodes);
                    setTotpOn(true);
                    setTotpUrl(null);
                    toast("success", "2FA enabled");
                  } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); }
                  setPwBusy(false);
                }}>Confirm &amp; enable</Button>
              </div>
            </>
          )}
          {recovery && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="mb-1 font-semibold">Save these one-time recovery codes — shown only once:</p>
              <code className="grid grid-cols-2 gap-x-4">{recovery.map((c) => c)}</code>
              <button className="mt-2 underline" onClick={() => setPwOn(JSON.stringify(recovery))}>I have saved them</button>
            </div>
          )}
          {totpOn && recovery && <p className="text-xs text-emerald-600">✓ Two-factor is on for this account.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Active sessions" description="Your signed-in devices" actions={<Button size="sm" variant="outline" onClick={async () => { try { await api.del("/auth/sessions", { allOthers: true }); toast("success", "Other sessions revoked"); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }}>Revoke others</Button>} />
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {sessions.map((sess) => (
            <li key={sess.id} className="flex items-center justify-between px-4 py-2.5">
              <span className="min-w-0 truncate">{(sess.userAgent ?? "unknown device").slice(0, 70)}</span>
              <span className="shrink-0 pl-3 text-xs text-zinc-400">{sess.ip ?? ""} · {new Date(sess.lastSeenAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </li>
          ))}
          {sessions.length === 0 && <li className="px-4 py-4 text-zinc-400">No sessions loaded.</li>}
        </ul>
      </Card>
      {pwOn && <input type="hidden" value={pwOn} readOnly />}
    </div>
  );
}
