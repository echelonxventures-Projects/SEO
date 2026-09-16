"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td, Textarea } from "@/components/ui";
import { fmtDate, statusClass } from "@/lib/format";
import { toast } from "@/components/toast";

type Blog = {
  id: string;
  title: string;
  slug: string;
  status: string;
  keywords: string[];
  readingMinutes: number;
  updatedAt: string;
  publishedAt: string | null;
  client: { name: string } | null;
};

export default function BlogsPage() {
  const [rows, setRows] = useState<Blog[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Blog | null>(null);
  const [manual, setManual] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get<Blog[]>("/blogs")
      .then(setRows)
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function setStatus(b: Blog, status: string) {
    try {
      await api.patch(`/blogs/${b.id}`, { status });
      toast("success", status === "PUBLISHED" ? "Published" : "Updated");
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Blog posts"
        description="Studio drafts and manual posts — publish when the SEO brief is met."
        actions={<Button size="sm" onClick={() => setManual(true)}>Write manually</Button>}
      />
      <Card>
        <CardHeader title="Posts" description={`${rows.length} total`} />
        {loading ? (
          <div className="space-y-3 p-6">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="No posts yet" hint="Generate one in the AI studio, then save it as a blog draft." />
        ) : (
          <TWrap>
            <thead><tr><Th>Title</Th><Th>Client</Th><Th>Keywords</Th><Th>Read</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <Td>
                    <button className="text-left font-medium hover:underline" onClick={() => setEditing(b)}>{b.title}</button>
                    <p className="text-xs text-zinc-400">/{b.slug}</p>
                  </Td>
                  <Td className="text-zinc-500">{b.client?.name ?? "—"}</Td>
                  <Td className="max-w-52 truncate text-xs text-zinc-500">{b.keywords.join(", ") || "—"}</Td>
                  <Td className="text-zinc-500">{b.readingMinutes} min</Td>
                  <Td><Badge className={statusClass(b.status)}>{b.status.toLowerCase()}</Badge></Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setEditing(b)} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Edit</button>
                      {b.status !== "PUBLISHED" && b.status !== "ARCHIVED" && (
                        <button onClick={() => setStatus(b, b.status === "DRAFT" ? "IN_REVIEW" : "PUBLISHED")} className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">
                          {b.status === "DRAFT" ? "To review" : "Publish"}
                        </button>
                      )}
                      {b.status === "PUBLISHED" && (
                        <button onClick={() => setStatus(b, "ARCHIVED")} className="rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Archive</button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>
      {editing && <Editor blog={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {manual && <Editor blog={null} onClose={() => setManual(false)} onDone={() => { setManual(false); load(); }} />}
    </div>
  );
}

function Editor({ blog, onClose, onDone }: { blog: Blog | null; onClose: () => void; onDone: () => void }) {
  const [full, setFull] = useState<{ bodyMarkdown: string; metaDescription: string | null; keywords: string[] } | null>(null);
  const [title, setTitle] = useState(blog?.title ?? "");
  const [body, setBody] = useState("");
  const [meta, setMeta] = useState("");
  const [keywords, setKeywords] = useState("");
  const [clients, setClients] = useState<Array<{ value: string; label: string }>>([]);
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    api.get<{ rows: Array<{ id: string; name: string }> }>("/clients?pageSize=200").then((r) => setClients(r.rows.map((c) => ({ value: c.id, label: c.name })))).catch(() => {});
    if (blog) {
      api.get<{ bodyMarkdown: string; metaDescription: string | null; keywords: string[] }>(`/blogs/${blog.id}`)
        .then((f) => {
          setFull(f);
          setBody(f.bodyMarkdown);
          setMeta(f.metaDescription ?? "");
          setKeywords(f.keywords.join(", "));
        })
        .catch(() => toast("error", "Could not load post"));
    }
  }, [blog]);

  return (
    <Modal open onClose={onClose} title={blog ? `Edit — ${blog.title}` : "New blog post"} wide>
      <div className="space-y-3">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Meta description"><Input value={meta} onChange={(e) => setMeta(e.target.value)} maxLength={300} /></Field>
          <Field label="Keywords (comma separated)"><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} /></Field>
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)} options={[{ value: "", label: "—" }, ...clients]} />
          </Field>
          <div className="flex items-end justify-end">
            <Button size="sm" variant="outline" onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</Button>
          </div>
        </div>
        {preview ? (
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 font-sans text-sm dark:bg-zinc-800/40">{body}</pre>
        ) : (
          <Field label="Body (markdown)"><Textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" /></Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            if (!title.trim() || body.trim().length < 20) { toast("error", "Title and body (min 20 chars) required"); return; }
            setBusy(true);
            try {
              const payload = {
                title: title.trim(),
                bodyMarkdown: body,
                metaDescription: meta || null,
                keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
                clientId: clientId || null,
              };
              if (blog && full) await api.patch(`/blogs/${blog.id}`, payload);
              else await api.post("/blogs", { ...payload, jobId: null });
              toast("success", "Saved");
              onDone();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
