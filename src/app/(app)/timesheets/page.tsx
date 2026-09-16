"use client";

import { ResourceScreen, StatusBadge, type Column, type FieldDef } from "@/components/crud";
import { useLookups } from "@/components/lookups";
import { fmtMinutes } from "@/lib/format";

type Entry = {
  id: string;
  date: string;
  minutes: number;
  billable: boolean;
  description: string | null;
  project: { name: string };
  task: { title: string } | null;
  user: { name: string };
};

export default function TimesheetsPage() {
  const { projects } = useLookups();

  const columns: Column<Entry>[] = [
    { header: "Date", cell: (e) => <span className="text-zinc-500">{new Date(e.date).toLocaleDateString("en-IN")}</span> },
    { header: "Member", cell: (e) => <span className="font-medium">{e.user.name}</span> },
    { header: "Project", cell: (e) => <span className="text-zinc-500">{e.project.name}</span> },
    { header: "Task", cell: (e) => <span className="text-zinc-500">{e.task?.title ?? "—"}</span> },
    { header: "Time", cell: (e) => <span className="font-medium">{fmtMinutes(e.minutes)}</span> },
    { header: "Billable", cell: (e) => (e.billable ? <StatusBadge value="ACTIVE" /> : <StatusBadge value="DRAFT" />) },
    { header: "Note", cell: (e) => <span className="text-xs text-zinc-400">{e.description ?? ""}</span> },
  ];

  const fields: FieldDef[] = [
    { name: "projectId", label: "Project", kind: "select", options: projects, required: true, half: true },
    { name: "date", label: "Date", kind: "date", required: true, half: true },
    { name: "minutes", label: "Minutes", kind: "number", required: true, default: 60, half: true },
    { name: "rate", label: "Rate override", kind: "money", half: true, hint: "Blank = project rate" },
    { name: "billable", label: "Billable", kind: "checkbox", default: true },
    { name: "description", label: "Note", kind: "textarea" },
  ];

  return (
    <ResourceScreen<Entry>
      basePath="/time"
      title="Timesheets"
      description="Log billable time; unbilled entries flow into invoices."
      columns={columns}
      fields={fields}
      canEdit={false}
      deleteLabel="Delete"
      toInitial={() => ({})}
    />
  );
}
