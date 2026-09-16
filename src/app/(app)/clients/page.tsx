"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, PageHeader, TWrap, Th, Td, Select } from "@/components/ui";
import { CrudFormModal, ListCard, RowActions, StatusBadge, Toolbar, type Column, type FieldDef } from "@/components/crud";
import { toast } from "@/components/toast";

type Client = {
  id: string;
  name: string;
  status: string;
  city: string | null;
  state: string | null;
  website: string | null;
  tags: Array<{ id: string; name: string; color: string }>;
  billingEmail: string | null;
  industry: { name: string } | null;
  currency: { code: string; symbol: string };
  owner: { name: string };
};

type FormValues = Record<string, string | null>;

const FIELDS: FieldDef[] = [
  { name: "name", label: "Client name", required: true, hint: "Must be unique in your workspace" },
  { name: "legalName", label: "Legal / registered name" },
  { name: "billingEmail", label: "Billing email", kind: "email" },
  { name: "phone", label: "Phone", kind: "tel" },
  { name: "website", label: "Website", placeholder: "https://…" },
  { name: "gstin", label: "GSTIN", placeholder: "27ABCDE1234F1Z5", hint: "Used for GST place-of-supply" },
  { name: "city", label: "City" },
  { name: "state", label: "State", hint: "Same state as you → CGST+SGST, else IGST" },
  { name: "country", label: "Country code", placeholder: "IN" },
  { name: "paymentTermsDays", label: "Payment terms (days)", kind: "number", default: 15 },
  { name: "taxExempt", label: "Tax exempt", kind: "checkbox" },
  { name: "tags", label: "Tags", hint: "comma separated — created on save" },
];

function useDebounce(value: string, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function ClientsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const dq = useDebounce(q);
  const [rows, setRows] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [initial, setInitial] = useState<FormValues | undefined>();
  const [allTags, setAllTags] = useState<Array<{ id: string; name: string }>>([]);
  const [tagFilter, setTagFilter] = useState("");
  useEffect(() => {
    api.get<Array<{ id: string; name: string }>>("/tags").then(setAllTags).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dq) params.set("q", dq);
    if (status) params.set("status", status);
    if (tagFilter) params.set("tag", tagFilter);
    api
      .get<{ rows: Client[] }>(`/clients?${params}`)
      .then((r) => setRows(r.rows))
      .catch((e) => toast("error", e.message))
      .finally(() => setLoading(false));
  }, [dq, status, tagFilter]);

  const columns: Column<Client>[] = useMemo(
    () => [
      {
        header: "Client",
        cell: (c) => (
          <div>
            <p className="font-medium">{c.name}</p>
            {c.industry && <p className="text-xs text-zinc-400">{c.industry.name}</p>}
          </div>
        ),
      },
      { header: "Status", cell: (c) => <StatusBadge value={c.status} /> },
      { header: "Billing", cell: (c) => <span className="text-xs text-zinc-500">{c.billingEmail ?? "—"}</span> },
      { header: "Location", cell: (c) => <span className="text-xs text-zinc-500">{[c.city, c.state].filter(Boolean).join(", ") || "—"}</span> },
      { header: "Owner", cell: (c) => <span className="text-xs text-zinc-500">{c.owner.name}</span> },
      {
        header: "Tags",
        cell: (c) => (
          <span className="flex flex-wrap gap-1">
            {c.tags.slice(0, 3).map((t) => (
              <span key={t.id} className={`rounded-full bg-${t.color}-500/10 px-2 py-0.5 text-[10px] font-medium text-${t.color}-600`}>{t.name}</span>
            ))}
            {c.tags.length > 3 && <span className="text-[10px] text-zinc-400">+{c.tags.length - 3}</span>}
          </span>
        ),
      },
      {
        header: "",
        className: "text-right",
        cell: (c) => (
          <RowActions>
            <Button size="sm" variant="ghost" onClick={() => router.push(`/clients/${c.id}`)}>
              Open
            </Button>
          </RowActions>
        ),
      },
    ],
    [router],
  );

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Every client you work with, bill and report on."
        actions={<Button size="sm" onClick={() => { setEditing(null); setInitial(undefined); setOpen(true); }}>New client</Button>}
      />
      <Toolbar
        search={q}
        onSearch={setQ}
        extra={
          <>
            <Select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="w-36"
              options={[{ value: "", label: "All tags" }, ...allTags.map((t) => ({ value: t.id, label: t.name }))]}
            />
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-40"
              options={[
                { value: "", label: "All statuses" },
                { value: "PROSPECT", label: "Prospect" },
                { value: "ACTIVE", label: "Active" },
                { value: "PAUSED", label: "Paused" },
                { value: "ARCHIVED", label: "Archived" },
              ]}
            />
          </>
        }
      />
      <ListCard loading={loading} empty={!loading && rows.length === 0}>
        <TWrap>
          <thead>
            <tr>
              {columns.map((col) => (
                <Th key={col.header} className={col.className}>{col.header}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                {columns.map((col, i) => (
                  <Td key={i} className={col.className}>{col.cell(c)}</Td>
                ))}
              </tr>
            ))}
          </tbody>
        </TWrap>
      </ListCard>

      <CrudFormModal
        key={editing?.id ?? "new"}
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.name}` : "New client"}
        fields={FIELDS}
        initial={initial as Record<string, unknown> | undefined}
        onSubmit={async (payload) => {
          if (editing) await api.patch(`/clients/${editing.id}`, payload);
          else await api.post("/clients", payload);
          router.refresh();
          setQ(q); // keep
          const params = new URLSearchParams();
          if (dq) params.set("q", dq);
          if (status) params.set("status", status);
          api.get<{ rows: Client[] }>(`/clients?${params}`).then((r) => setRows(r.rows));
        }}
      />
    </div>
  );
}
