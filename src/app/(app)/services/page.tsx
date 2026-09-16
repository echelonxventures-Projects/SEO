"use client";

import { ResourceScreen, type Column, type FieldDef } from "@/components/crud";
import { useLookups } from "@/components/lookups";
import { fmtMoney } from "@/lib/format";
import { Badge } from "@/components/ui";

type Service = {
  id: string;
  code: string;
  name: string;
  unit: string;
  priceMinor: number | bigint;
  active: boolean;
  currency: { symbol: string };
  category: { name: string } | null;
  taxRate: { name: string } | null;
};

export default function ServicesPage() {
  const { taxRates } = useLookups();
  const columns: Column<Service>[] = [
    { header: "Code", cell: (s) => <Badge className="bg-zinc-100 text-zinc-500 dark:bg-zinc-800">{s.code}</Badge> },
    { header: "Service", cell: (s) => <span className="font-medium">{s.name}</span> },
    { header: "Category", cell: (s) => <span className="text-zinc-500">{s.category?.name ?? "—"}</span> },
    { header: "Unit", cell: (s) => <span className="text-zinc-500 capitalize">{s.unit.toLowerCase()}</span> },
    { header: "Price", cell: (s) => <span className="font-medium">{fmtMoney(Number(s.priceMinor), s.currency.symbol)}</span> },
    { header: "Tax", cell: (s) => <span className="text-zinc-500">{s.taxRate?.name ?? "Exempt"}</span> },
  ];
  const fields: FieldDef[] = [
    { name: "code", label: "SKU code", required: true, half: true },
    { name: "name", label: "Name", required: true, half: true },
    { name: "unit", label: "Unit", kind: "select", options: [
      { value: "HOUR", label: "Hour" },
      { value: "PIECE", label: "Piece" },
      { value: "MONTH", label: "Month (retainer)" },
      { value: "PROJECT", label: "Project" },
      { value: "RETAINER", label: "Retainer" },
    ], default: "PROJECT", half: true },
    { name: "price", label: "Price", kind: "money", required: true, half: true },
    { name: "taxRateId", label: "Tax rate", kind: "select", options: [{ value: "", label: "Exempt" }, ...taxRates], half: true },
    { name: "active", label: "Active", kind: "checkbox", default: true },
    { name: "description", label: "Description", kind: "textarea" },
  ];
  return (
    <ResourceScreen<Service>
      basePath="/catalog/services"
      title="Services"
      description="Your sellable catalogue — priced and taxed, ready for quotes & invoices."
      columns={columns}
      fields={fields}
      canDelete={false}
      toInitial={(s) => ({ code: s.code, name: s.name, unit: s.unit, price: Number(s.priceMinor), active: s.active })}
    />
  );
}
