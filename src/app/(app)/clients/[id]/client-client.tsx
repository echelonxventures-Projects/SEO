"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";
import { CrudFormModal, StatusBadge, type FieldDef } from "@/components/crud";
import { useState } from "react";

type Project = { id: string; name: string; status: string; updatedAt: string };

const PROJECT_FIELDS: FieldDef[] = [
  { name: "name", label: "Project name", required: true, half: true },
  { name: "hourlyRate", label: "Hourly rate", kind: "money", half: true },
  { name: "retainerMonthly", label: "Monthly retainer", kind: "money", half: true },
  { name: "domainUrl", label: "Primary domain", placeholder: "https://…", half: true },
  { name: "summary", label: "Summary", kind: "textarea" },
];

export function ClientDetailClient({
  projects,
  clientId,
  client,
  permissions,
}: {
  projects: Project[];
  clientId: string;
  client: string;
  permissions: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const canWrite = permissions.includes("project.write");

  return (
    <div>
      {canWrite && (
        <div className="flex justify-end p-3">
          <Button size="sm" onClick={() => setOpen(true)}>
            New project for {client}
          </Button>
        </div>
      )}
      {projects.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-zinc-400">No projects yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-4 py-3">
              <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                {p.name}
              </Link>
              <div className="flex items-center gap-3">
                <StatusBadge value={p.status} />
                <span className="text-xs text-zinc-400">{new Date(p.updatedAt).toLocaleDateString("en-IN")}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <CrudFormModal
        open={open}
        onClose={() => setOpen(false)}
        title={`New project — ${client}`}
        fields={PROJECT_FIELDS}
        onSubmit={async (payload) => {
          await api.post("/projects", { ...payload, clientId });
          router.refresh();
        }}
      />
    </div>
  );
}
