"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, TWrap, Th, Td, Textarea } from "@/components/ui";
import { fmtDateTime, statusClass } from "@/lib/format";
import { toast } from "@/components/toast";

type Connection = { id: string; network: string; handle: string; displayName: string | null };
type Target = {
  id: string;
  status: string;
  scheduledAt: string;
  publishedAt: string | null;
  externalUrl: string | null;
  attempts: number;
  lastError: string | null;
  connection: { network: string; handle: string; displayName: string | null };
};
type Post = {
  id: string;
  title: string;
  body: string;
  hashtags: string[];
  status: string;
  targets: Target[];
  createdBy?: { name: string };
  campaign?: { name: string } | null;
};

export default function ContentPage() {
  const [rows, setRows] = useState<Post[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, c] = await Promise.all([
        api.get<{ rows: Post[] }>(`/content/posts${filter ? `?status=${filter}` : ""}`),
        api.get<Connection[]>("/social/connections"),
      ]);
      setRows(p.rows);
      setConnections(c);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  async function act(path: string) {
    try {
      await api.post(path, {});
      toast("success", "Done");
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div>
      <PageHeader
        title="Content calendar"
        description="Compose once, schedule per channel, publish automatically."
        actions={
          <div className="flex gap-2">
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-44" options={[
              { value: "", label: "All statuses" },
              { value: "SCHEDULED", label: "Scheduled" },
              { value: "PUBLISHED", label: "Published" },
              { value: "FAILED", label: "Failed" },
              { value: "CANCELLED", label: "Cancelled" },
            ]} />
            <Button size="sm" onClick={() => setComposer(true)}>New post</Button>
          </div>
        }
      />
      <Card>
        <CardHeader title="Queue" description={`${rows.length} posts`} />
        {loading ? (
          <div className="space-y-3 p-6">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing scheduled" hint="Write a post and pick channels + times — the publisher runs on schedule." />
        ) : (
          <TWrap>
            <thead><tr><Th>Post</Th><Th>Channels</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="align-top">
                  <Td>
                    <p className="font-medium">{p.title}</p>
                    <p className="mt-0.5 line-clamp-2 max-w-md text-xs text-zinc-400">{p.body}</p>
                  </Td>
                  <Td>
                    <div className="space-y-1">
                      {p.targets.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 text-xs">
                          <Badge className={statusClass(t.status)}>{t.status.toLowerCase()}</Badge>
                          <span>{t.connection.displayName ?? t.connection.handle}</span>
                          <span className="text-zinc-400">{fmtDateTime(t.scheduledAt)}</span>
                          {t.externalUrl && <a className="text-sky-600 hover:underline" href={t.externalUrl} target="_blank" rel="noopener noreferrer">↗</a>}
                          {t.status === "FAILED" && t.lastError && <span className="max-w-40 truncate text-red-500" title={t.lastError}>{t.lastError}</span>}
                          {t.status === "FAILED" && (
                            <button className="text-zinc-500 underline hover:text-zinc-800" onClick={() => act(`/content/targets/${t.id}/retry`)}>retry</button>
                          )}
                        </div>
                      ))}
                    </div>
                  </Td>
                  <Td><Badge className={statusClass(p.status)}>{p.status.toLowerCase().replace(/_/g, " ")}</Badge></Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {["SCHEDULED", "FAILED", "PARTIALLY_PUBLISHED"].includes(p.status) && p.targets.some((t) => t.status === "PENDING") && (
                        <button onClick={() => act(`/content/posts/${p.id}/publish-now`)} className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">Publish now</button>
                      )}
                      {["SCHEDULED", "FAILED"].includes(p.status) && (
                        <button onClick={() => act(`/content/posts/${p.id}/cancel`)} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Cancel</button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>
      {composer && <Composer connections={connections} onClose={() => setComposer(false)} onDone={() => { setComposer(false); load(); }} />}
    </div>
  );
}

function Composer({ connections, onClose, onDone }: { connections: Connection[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setTargets((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Modal open onClose={onClose} title="New post" wide>
      <div className="space-y-3">
        <Field label="Internal title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali offer — week 1" /></Field>
        <Field label="Post copy">
          <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The exact text to publish…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hashtags" hint="Space or comma separated"><Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="seo, growth" /></Field>
          <Field label="Schedule for (your local time)"><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-600">Channels {connections.length === 0 && "— connect one first on the Social screen"}</p>
          <div className="flex flex-wrap gap-2">
            {connections.map((c) => (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${targets.includes(c.id) ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700"}`}
              >
                {c.displayName ?? c.handle}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            if (!title.trim() || !body.trim() || targets.length === 0) {
              toast("error", "Title, copy and at least one channel are required");
              return;
            }
            setBusy(true);
            try {
              const dt = new Date(when);
              await api.post("/content/posts", {
                title: title.trim(),
                body: body.trim(),
                hashtags: hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, "")).filter(Boolean),
                targets: targets.map((id) => ({ connectionId: id, scheduledAt: dt.toISOString() })),
              });
              toast("success", "Scheduled");
              onDone();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
            } finally {
              setBusy(false);
            }
          }}>Schedule post</Button>
        </div>
      </div>
    </Modal>
  );
}
