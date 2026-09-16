"use client";

import { useEffect, useState } from "react";
import { fmtMoney } from "@/lib/format";
import {
  ResourceScreen,
  StatusBadge,
  type Column,
  type FieldDef,
} from "@/components/crud";
import { useLookups } from "@/components/lookups";

type Project = {
  id: string;
  name: string;
  status: string;
  client: { name: string };
  owner: { name: string };
  currency: { symbol: string };
  budgetMinor: number | bigint | null;
};

export default function ProjectsPage() {
  const { clients } = useLookups();
  const [clientId, setClientId] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const c = q.get("clientId");
    if (c) setClientId(c);
  }, []);

  const columns: Column<Project>[] = [
    { header: "Project", cell: (p) => <span className="font-medium">{p.name}</span> },
    { header: "Client", cell: (p) => <span className="text-zinc-500">{p.client.name}</span> },
    { header: "Status", cell: (p) => <StatusBadge value={p.status} /> },
    { header: "Owner", cell: (p) => <span className="text-zinc-500">{p.owner.name}</span> },
    { header: "Budget", cell: (p) => <span>{p.budgetMinor != null ? fmtMoney(Number(p.budgetMinor), p.currency.symbol) : "—"}</span> },
  ];

  const fields: FieldDef[] = [
    { name: "clientId", label: "Client", kind: "select", options: clients, required: true, half: true },
    { name: "name", label: "Project name", required: true, half: true },
    { name: "hourlyRate", label: "Default hourly rate", kind: "money", half: true, hint: "Used when billing time" },
    { name: "retainerMonthly", label: "Monthly retainer", kind: "money", half: true },
    { name: "budget", label: "Total budget", kind: "money", half: true },
    { name: "startDate", label: "Start date", kind: "date", half: true },
    { name: "endDate", label: "End date", kind: "date", half: true },
    { name: "domainUrl", label: "Primary domain", placeholder: "https://…", half: true },
    { name: "summary", label: "Summary", kind: "textarea" },
  ];

  return (
    <ResourceScreen<Project>
      basePath={clientId ? `/projects?clientId=${clientId}` : "/projects"}
      title="Projects"
      description="Client work, billed by time, retainer or fixed scope."
      columns={columns}
      fields={fields}
      toInitial={(p) => ({ clientId: p.client?.name ? "" : "", name: p.name })}
    />
  );
}
