"use client";

import { useState } from "react";
import {
  ResourceScreen,
  StatusBadge,
  type Column,
  type FieldDef,
} from "@/components/crud";
import { useLookups } from "@/components/lookups";

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  project: { name: string; client: { name: string } };
  assignee: { name: string } | null;
};

export default function TasksPage() {
  const { projects, members } = useLookups();
  const [filter, setFilter] = useState("");

  const columns: Column<Task>[] = [
    { header: "Task", cell: (t) => <span className="font-medium">{t.title}</span> },
    { header: "Project", cell: (t) => <span className="text-zinc-500">{t.project.name}</span> },
    { header: "Assignee", cell: (t) => <span className="text-zinc-500">{t.assignee?.name ?? "—"}</span> },
    { header: "Priority", cell: (t) => <StatusBadge value={t.priority} /> },
    { header: "Status", cell: (t) => <StatusBadge value={t.status} /> },
    { header: "Due", cell: (t) => <span className="text-xs text-zinc-500">{t.dueDate ? new Date(t.dueDate).toLocaleDateString("en-IN") : "—"}</span> },
  ];

  const fields: FieldDef[] = [
    { name: "projectId", label: "Project", kind: "select", options: projects, required: true, half: true },
    { name: "title", label: "Title", required: true, half: true },
    { name: "priority", label: "Priority", kind: "select", options: [
      { value: "LOW", label: "Low" },
      { value: "MEDIUM", label: "Medium" },
      { value: "HIGH", label: "High" },
      { value: "URGENT", label: "Urgent" },
    ], default: "MEDIUM", half: true },
    { name: "assigneeId", label: "Assignee", kind: "select", options: members, half: true },
    { name: "dueDate", label: "Due date", kind: "date", half: true },
    { name: "estimatedMinutes", label: "Estimated minutes", kind: "number", half: true },
    { name: "description", label: "Description", kind: "textarea" },
  ];

  return (
    <>
      <ResourceScreen<Task>
        basePath={filter ? `/tasks?projectId=${filter}` : "/tasks"}
        title="Tasks"
        description="Work items across all projects."
        columns={columns}
        fields={fields}
      />
      {projects.length > 0 && (
        <div className="mb-3 -mt-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
