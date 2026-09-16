"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea, TWrap, Th, Td } from "@/components/ui";
import { toast } from "@/components/toast";

type Pixel = { id: string; platform: string; label: string; pixelId: string; active: boolean; placement: string; template: { id: string; key: string; label: string } | null };
type TagTemplate = { id: string; key: string; label: string; body: string; placement: string; docUrl: string | null; active: boolean; orgId: string | null };
type Property = {
  id: string;
  name: string;
  domain: string;
  verification: string;
  ga4MeasurementId: string | null;
  client: { name: string };
  pixels: Pixel[];
};

export default function SitesPage() {
  const [rows, setRows] = useState<Property[]>([]);
  const [clients, setClients] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [snippetFor, setSnippetFor] = useState<Property | null>(null);
  const [templates, setTemplates] = useState<TagTemplate[]>([]);
  const [tmplOpen, setTmplOpen] = useState<TagTemplate | "new" | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Property[]>("/sites/properties")
      .then(setRows)
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  const loadTemplates = useCallback(() => {
    api.get<TagTemplate[]>("/sites/templates").then(setTemplates).catch(() => {});
  }, []);
  useEffect(loadTemplates, [loadTemplates]);
  useEffect(() => {
    void load();
    api.get<{ rows: Array<{ id: string; name: string }> }>("/clients?pageSize=200")
      .then((c) => setClients(c.rows.map((r) => ({ value: r.id, label: r.name }))))
      .catch(() => {});
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Sites & pixels"
        description="Every client web property with its tracking tags — one paste-ready bundle per site."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setTmplOpen("new")}>New tag template</Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>Add property</Button>
          </div>
        }
      />
      <Card>
        <CardHeader title="Properties" description={`${rows.length} sites`} />
        {loading ? (
          <div className="p-4 text-sm text-zinc-400">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No properties yet" hint="Add a client site to manage its GA4 / pixel tags." />
        ) : (
          <TWrap>
            <thead><tr><Th>Site</Th><Th>Client</Th><Th>Tags</Th><Th>Verified</Th><Th className="text-right">Embed</Th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <Td><p className="font-medium">{p.name}</p><p className="text-xs text-zinc-400">{p.domain}</p></Td>
                  <Td className="text-zinc-500">{p.client.name}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {p.ga4MeasurementId && !p.pixels.some((x) => x.platform === "GOOGLE_ANALYTICS") && (
                        <Badge className="bg-sky-500/10 text-sky-600">GA4</Badge>
                      )}
                      {p.pixels.map((x) => (
                        <Badge key={x.id} className={x.active ? "bg-emerald-500/10 text-emerald-600" : "bg-zinc-500/10 text-zinc-400 line-through"}>
                          {x.label}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <Badge className={p.verification === "VERIFIED" ? "bg-emerald-500/15 text-emerald-600" : "bg-zinc-500/10 text-zinc-500"}>
                      {p.verification.toLowerCase()}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {p.verification !== "VERIFIED" && (
                        <button onClick={async () => { await api.post(`/sites/properties/${p.id}/verify`); load(); }} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Mark verified</button>
                      )}
                      <button onClick={() => setSnippetFor(p)} className="rounded px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-950">Get snippet</button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>
      <Card className="mt-4">
        <CardHeader
          title="Tag templates"
          description="Snippet shapes live here — add Clarity, Hotjar or any vendor by filling the blanks ({{pixelId}}, {{label}}, {{domain}}, {{name}})"
        />
        <TWrap>
          <thead><tr><Th>Key</Th><Th>Label</Th><Th>Scope</Th><Th>Placement</Th><Th>Status</Th><Th className="text-right"></Th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <Td className="font-mono text-xs">{t.key}</Td>
                <Td>{t.label}</Td>
                <Td className="text-zinc-500">{t.orgId ? "workspace" : "platform"}</Td>
                <Td className="text-zinc-500">{t.placement}</Td>
                <Td><Badge className={t.active ? "bg-emerald-500/15 text-emerald-600" : "bg-zinc-500/10 text-zinc-500"}>{t.active ? "active" : "off"}</Badge></Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1.5">
                    <button onClick={() => setTmplOpen(t)} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Edit</button>
                    <button onClick={async () => { try { await api.post(`/sites/templates/${t.id}/toggle`, { active: !t.active }); loadTemplates(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t.active ? "Disable" : "Enable"}</button>
                  </div>
                </Td>
              </tr>
            ))}
            {templates.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-zinc-400">Run the seed to load platform tag templates</td></tr>}
          </tbody>
        </TWrap>
      </Card>
      {addOpen && <PropertyModal clients={clients} templates={templates} onClose={() => setAddOpen(false)} onDone={load} />}
      {tmplOpen && <TemplateModal initial={tmplOpen === "new" ? null : tmplOpen} onClose={() => setTmplOpen(null)} onDone={loadTemplates} />}
      {snippetFor && <SnippetModal property={snippetFor} onClose={() => setSnippetFor(null)} />}
    </div>
  );
}

function PropertyModal({ clients, templates, onClose, onDone }: { clients: Array<{ value: string; label: string }>; templates: TagTemplate[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", clientId: "", domain: "", ga4: "", pixels: [] as Array<{ templateId: string; label: string; pixelId: string }> });
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const prop = await api.post<{ id: string }>("/sites/properties", {
        name: f.name,
        clientId: f.clientId,
        domain: f.domain,
        ga4MeasurementId: f.ga4 || null,
      });
      for (const p of f.pixels.filter((x) => x.templateId && x.pixelId)) {
        await api.post(`/sites/properties/${prop.id}/pixels`, { templateId: p.templateId, label: p.label, pixelId: p.pixelId });
      }
      toast("success", "Property created");
      onDone();
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New web property" wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Lumen main site" /></Field>
          <Field label="Client"><Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} options={[{ value: "", label: "Select…" }, ...clients]} /></Field>
          <Field label="Domain"><Input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="example.com" /></Field>
          <Field label="GA4 measurement ID (optional)"><Input value={f.ga4} onChange={(e) => setF({ ...f, ga4: e.target.value })} placeholder="G-XXXXXXX" /></Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-zinc-600">Tracking tags</p>
            <button onClick={() => setF({ ...f, pixels: [...f.pixels, { templateId: templates[0]?.id ?? "", label: "", pixelId: "" }] })} className="text-xs font-medium text-sky-600 hover:underline">+ Add tag</button>
          </div>
          <div className="space-y-2">
            {f.pixels.map((p, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <Select value={p.templateId} onChange={(e) => setF({ ...f, pixels: f.pixels.map((x, j) => (j === i ? { ...x, templateId: e.target.value } : x)) })} options={templates.map((t) => ({ value: t.id, label: t.label }))} />
                <Input placeholder="Label" value={p.label} onChange={(e) => setF({ ...f, pixels: f.pixels.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <Input placeholder="Pixel / tag id" value={p.pixelId} onChange={(e) => setF({ ...f, pixels: f.pixels.map((x, j) => (j === i ? { ...x, pixelId: e.target.value } : x)) })} />
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={create} disabled={!f.name || !f.clientId || !f.domain}>Create property</Button>
        </div>
      </div>
    </Modal>
  );
}

function SnippetModal({ property, onClose }: { property: Property; onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    api.get<string>(`/sites/properties/${property.id}/snippet`).then(setCode).catch((e) => toast("error", e.message));
  }, [property.id]);
  return (
    <Modal open onClose={onClose} title={`Embed — ${property.domain}`} wide>
      <p className="mb-3 text-xs text-zinc-500">Paste this into your site&apos;s <code>&lt;head&gt;</code> (or the CMS header field). Keep the site as the single source of truth for its tags.</p>
      {!code ? (
        <div className="h-24 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      ) : (
        <div className="relative">
          <pre className="max-h-80 overflow-auto rounded-lg bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-100 dark:bg-black">{code}</pre>
          <Button size="sm" variant="secondary" className="absolute right-2 top-2" onClick={() => navigator.clipboard?.writeText(code).then(() => toast("success", "Snippet copied"))}>
            Copy
          </Button>
        </div>
      )}
    </Modal>
  );
}

function TemplateModal({ initial, onClose, onDone }: { initial: TagTemplate | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    key: initial?.key ?? "",
    label: initial?.label ?? "",
    body: initial?.body ?? `<!-- {{label}} -->\n<script>\n// paste vendor snippet and replace the id with {{pixelId}}\n</script>`,
    placement: initial?.placement ?? "HEAD",
    docUrl: initial?.docUrl ?? "",
  });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={initial ? `Template — ${initial.key}` : "New tag template"} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Key (UPPER_SNAKE)" hint={initial ? "key is fixed on edit" : "e.g. CLARITY, HOTJAR"}>
            <Input value={f.key} disabled={Boolean(initial)} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase() })} placeholder="CLARITY" />
          </Field>
          <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Microsoft Clarity" /></Field>
        </div>
        <Field label="Snippet body" hint="Placeholders: {{pixelId}} {{label}} {{domain}} {{name}} {{propertyId}}">
          <Textarea rows={8} className="font-mono text-xs" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Placement"><Select value={f.placement} onChange={(e) => setF({ ...f, placement: e.target.value })} options={[{ value: "HEAD", label: "Head" }, { value: "BODY_START", label: "Body start" }]} /></Field>
          <Field label="Docs URL (optional)"><Input value={f.docUrl} onChange={(e) => setF({ ...f, docUrl: e.target.value })} placeholder="https://…" /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              const body = { key: f.key, label: f.label, body: f.body, placement: f.placement, docUrl: f.docUrl || null };
              if (initial) await api.patch(`/sites/templates/${initial.id}`, body);
              else await api.post("/sites/templates", body);
              toast("success", "Template saved");
              onDone();
              onClose();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Save template</Button>
        </div>
      </div>
    </Modal>
  );
}
