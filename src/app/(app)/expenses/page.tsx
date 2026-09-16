"use client";

import { ResourceScreen, StatusBadge, type Column, type FieldDef } from "@/components/crud";
import { useLookups } from "@/components/lookups";
import { fmtMoney } from "@/lib/format";

type Expense = {
  id: string;
  date: string;
  amountMinor: number | bigint;
  billable: boolean;
  description: string | null;
  project: { name: string };
  category: { name: string } | null;
};

export default function ExpensesPage() {
  const { projects } = useLookups();
  const columns: Column<Expense>[] = [
    { header: "Date", cell: (e) => <span className="text-zinc-500">{new Date(e.date).toLocaleDateString("en-IN")}</span> },
    { header: "Project", cell: (e) => <span className="font-medium">{e.project.name}</span> },
    { header: "Category", cell: (e) => <span className="text-zinc-500">{e.category?.name ?? "—"}</span> },
    { header: "Description", cell: (e) => <span className="text-zinc-500">{e.description ?? ""}</span> },
    { header: "Amount", cell: (e) => <span className="font-medium">{fmtMoney(Number(e.amountMinor))}</span> },
    { header: "Billable", cell: (e) => (e.billable ? <StatusBadge value="ACTIVE" /> : <StatusBadge value="DRAFT" />) },
  ];
  const fields: FieldDef[] = [
    { name: "projectId", label: "Project", kind: "select", options: projects, required: true, half: true },
    { name: "date", label: "Date", kind: "date", required: true, half: true },
    { name: "amount", label: "Amount", kind: "money", required: true, half: true },
    { name: "billable", label: "Recharge to client", kind: "checkbox", default: true },
    { name: "description", label: "Description", kind: "textarea" },
  ];
  return (
    <ResourceScreen<Expense>
      basePath="/expenses"
      title="Expenses"
      description="Out-of-pocket costs, optionally recharged on invoices."
      columns={columns}
      fields={fields}
      toInitial={() => ({})}
    />
  );
}
