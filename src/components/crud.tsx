"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { toast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Textarea,
  TWrap,
  Th,
  Td,
  useFormBusy,
} from "@/components/ui";
import { Plus, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Field spec
// ---------------------------------------------------------------------------

export type FieldKind = "text" | "textarea" | "number" | "money" | "select" | "date" | "checkbox" | "email" | "password" | "tel";

export type FieldDef = {
  name: string;
  label: string;
  kind?: FieldKind;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  default?: string | number | boolean | null;
  half?: boolean;
  when?: (v: Record<string, unknown>) => boolean;
};

function toFormValue(f: FieldDef): string {
  if ((f.kind ?? "text") === "checkbox") return f.default ? "on" : "";
  if (f.default == null) return "";
  return String(f.default);
}

export function FormFields({
  fields,
  values,
  setValues,
  errors,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  setValues: (v: Record<string, string>) => void;
  errors: Record<string, string>;
}) {
  const set = (k: string, v: string) => setValues({ ...values, [k]: v });
  return (
    <>
      {fields
        .filter((f) => !f.when || f.when(values))
        .map((f) => {
          const kind = f.kind ?? "text";
          const cls = f.half ? "sm:col-span-1" : "sm:col-span-2";
          if (kind === "checkbox") {
            return (
              <div key={f.name} className={cls}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={values[f.name] === "on"}
                    onChange={(e) => set(f.name, e.target.checked ? "on" : "")}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  {f.label}
                </label>
              </div>
            );
          }
          return (
            <div key={f.name} className={cls}>
              <Field label={f.label} error={errors[f.name]} hint={f.hint}>
                {kind === "select" ? (
                  <Select value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} options={f.options ?? []} />
                ) : kind === "textarea" ? (
                  <Textarea value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />
                ) : (
                  <Input
                    type={kind === "money" || kind === "number" ? "number" : kind}
                    step={kind === "money" || kind === "number" ? "0.01" : undefined}
                    min={kind === "money" || kind === "number" ? 0 : undefined}
                    value={values[f.name] ?? ""}
                    onChange={(e) => set(f.name, e.target.value)}
                    placeholder={f.placeholder}
                    required={f.required}
                  />
                )}
              </Field>
            </div>
          );
        })}
    </>
  );
}

function buildPayload(fields: FieldDef[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.when && !f.when(values)) continue;
    const raw = values[f.name];
    const k = f.kind ?? "text";
    if (k === "checkbox") {
      out[f.name] = raw === "on";
    } else if (k === "money" || k === "number") {
      out[f.name] = raw === "" || raw == null ? null : Number(raw);
    } else if (k === "select") {
      out[f.name] = raw === "" ? null : raw;
    } else {
      out[f.name] = raw === "" ? null : raw;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Create / Edit modal
// ---------------------------------------------------------------------------

export function CrudFormModal({
  open,
  onClose,
  title,
  fields,
  initial,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: FieldDef[];
  initial?: Record<string, unknown>;
  onSubmit: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const blank = useMemo(() => {
    const v: Record<string, string> = {};
    for (const f of fields) {
      const key = f.name;
      if (initial && initial[key] != null) {
        const kk = f.kind ?? "text";
        v[key] = kk === "checkbox" ? (initial[key] ? "on" : "") : String(kk === "money" && typeof initial[key] === "number" ? (initial[key] as number) / 100 : initial[key]);
      } else {
        v[key] = toFormValue(f);
      }
    }
    return v;
  }, [fields, initial]);

  const [values, setValues] = useState<Record<string, string>>(blank);
  useEffect(() => setValues(blank), [blank]);
  const onDone = useCallback(() => onClose(), [onClose]);
  const { busy, errors, run } = useFormBusy(onDone);

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await onSubmit(buildPayload(fields, values));
            onClose();
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormFields fields={fields} values={values} setValues={setValues} errors={errors} />
        </div>
        <FormSubmit busy={busy} />
      </form>
    </Modal>
  );
}

function FormSubmit({ busy }: { busy: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button type="submit" loading={busy}>
        Save
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column + table
// ---------------------------------------------------------------------------

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  hidden?: boolean;
};

export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-1.5">{children}</div>;
}

export function ActionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(href)}
      className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-zinc-300">—</span>;
  return (
    <Badge className={cn("border border-transparent", badgeClass(value))}>
      {value.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

function badgeClass(status: string): string {
  const good = ["ACTIVE", "PAID", "COMPLETED", "ACCEPTED", "WON", "LIVE", "PASS", "CONVERTED", "PROCESSED"];
  const bad = ["OVERDUE", "VOID", "DECLINED", "LOST", "FAILED", "PAST_DUE", "CRITICAL", "ERROR", "EXPIRED", "SUSPENDED"];
  const warn = ["DRAFT", "SENT", "PARTIALLY_PAID", "BLOCKED", "PENDING", "ON_HOLD", "PAUSED", "WARNING", "REVIEW"];
  const s = status.toUpperCase();
  if (good.includes(s)) return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (bad.includes(s)) return "bg-red-500/15 text-red-600 dark:text-red-400";
  if (warn.includes(s)) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400";
}

// ---------------------------------------------------------------------------
// useResource — client data hook
// ---------------------------------------------------------------------------

export function useResource<T>(path: string, deps: string = "") {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ rows?: T[] } | T[]>(path);
      setRows(Array.isArray(res) ? res : (res?.rows ?? []));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load, deps]);
  return { rows, loading, error, reload: load };
}

export function Toolbar({
  onNew,
  newLabel,
  search,
  onSearch,
  extra,
}: {
  onNew?: () => void;
  newLabel?: string;
  search?: string;
  onSearch?: (v: string) => void;
  extra?: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {onSearch && (
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search…"
            className="w-56 pl-8"
          />
        </div>
      )}
      {extra}
      <div className="ml-auto flex gap-2">
        <Button variant="outline" size="sm" onClick={() => router.refresh()} title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        {onNew && (
          <Button size="sm" onClick={onNew}>
            <Plus className="h-3.5 w-3.5" /> {newLabel ?? "New"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ListCard({ loading, empty, children }: { loading: boolean; empty?: boolean; children: ReactNode }) {
  if (loading) {
    return (
      <Card>
        <div className="space-y-3 p-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          ))}
        </div>
      </Card>
    );
  }
  if (empty) {
    return (
      <Card>
        <EmptyState title="Nothing here yet" hint="Create your first record to get started." />
      </Card>
    );
  }
  return <Card>{children}</Card>;
}

export { toast };

// ---------------------------------------------------------------------------
// ResourceScreen — full list + create/edit/delete in one configurable widget
// ---------------------------------------------------------------------------

export type Action<T> = {
  label: string;
  danger?: boolean;
  confirm?: string;
  show?: (row: T) => boolean;
  run: (row: T) => Promise<unknown>;
};

export function ResourceScreen<T extends { id: string }>({
  basePath,
  title,
  description,
  columns,
  fields,
  editFields,
  toInitial,
  actions,
  canCreate = true,
  canEdit = true,
  canDelete = true,
  deleteLabel = "Delete",
  extraFilters,
  rowKey = "id",
  emptyTitle,
}: {
  basePath: string;
  title: string;
  description?: string;
  columns: Column<T>[];
  fields: FieldDef[];
  editFields?: FieldDef[];
  toInitial?: (row: T) => Record<string, unknown>;
  actions?: Action<T>[];
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  deleteLabel?: string;
  extraFilters?: ReactNode;
  rowKey?: (keyof T & string);
  emptyTitle?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const path = useMemo(() => {
    const [base, existing] = basePath.split("?");
    const p = new URLSearchParams(existing ?? "");
    if (debounced) p.set("q", debounced);
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  }, [basePath, debounced]);

  const { rows, loading, error, reload } = useResource<T>(path);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const initial = editing && toInitial ? toInitial(editing) : undefined;

  const cols = actions?.length || canEdit || canDelete
    ? [
        ...columns,
        {
          header: "",
          className: "text-right",
          cell: (row: T) => (
            <RowActions>
              {(actions ?? []).map((a) =>
                a.show && !a.show(row) ? null : (
                  <button
                    key={a.label}
                    disabled={busyId === (row[rowKey] as string)}
                    onClick={async () => {
                      if (a.confirm && !window.confirm(a.confirm)) return;
                      setBusyId(row[rowKey] as string);
                      try {
                        await a.run(row);
                        toast("success", `${a.label} done`);
                        reload();
                      } catch (e) {
                        toast("error", e instanceof Error ? e.message : `${a.label} failed`);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className={cn(
                      "rounded px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800",
                      a.danger ? "text-red-600" : "text-zinc-600 dark:text-zinc-300",
                    )}
                  >
                    {a.label}
                  </button>
                ),
              )}
              {canEdit && (
                <button
                  onClick={() => {
                    setEditing(row);
                    setOpen(true);
                  }}
                  className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Edit
                </button>
              )}
              {canDelete && (
                <button
                  disabled={busyId === (row[rowKey] as string)}
                  onClick={async () => {
                    if (!window.confirm(`Delete this record? This cannot be undone.`)) return;
                    setBusyId(row[rowKey] as string);
                    try {
                      await api.del(`${basePath}/${row[rowKey] as string}`);
                      toast("success", "Deleted");
                      reload();
                      router.refresh();
                    } catch (e) {
                      toast("error", e instanceof Error ? e.message : "Delete failed");
                    } finally {
                      setBusyId(null);
                    }
                  }}
                  className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
                >
                  {deleteLabel}
                </button>
              )}
            </RowActions>
          ),
        } as Column<T>,
      ]
    : columns;

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          canCreate && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          )
        }
      />
      <Toolbar search={search} onSearch={setSearch} extra={extraFilters} />
      {error && (
        <Card className="mb-3 p-4 text-sm text-red-600">{error}</Card>
      )}
      <ListCard loading={loading} empty={!loading && rows.length === 0}>
        {rows.length === 0 ? (
          <EmptyState title={emptyTitle ?? "Nothing here yet"} />
        ) : (
          <TWrap>
            <thead>
              <tr>
                {cols.map((col, i) => (
                  <Th key={i} className={col.className}>
                    {col.header}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[rowKey] as string} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  {cols.map((col, i) => (
                    <Td key={i} className={col.className}>
                      {col.cell(row)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </ListCard>
      {(canCreate || canEdit) && (
        <CrudFormModal
          key={`${(editing?.[rowKey] as string) ?? "new"}-${open}`}
          open={open}
          onClose={() => setOpen(false)}
          title={editing ? `Edit ${title.replace(/s$/, "").toLowerCase()}` : `New ${title.replace(/s$/, "").toLowerCase()}`}
          fields={editing && editFields ? editFields : fields}
          initial={initial}
          onSubmit={async (payload) => {
            if (editing) await api.patch(`${basePath}/${editing[rowKey] as string}`, payload);
            else await api.post(basePath, payload);
            reload();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

