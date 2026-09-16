"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type Option = { value: string; label: string };

export function useLookups() {
  const [clients, setClients] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [stages, setStages] = useState<Option[]>([]);
  const [services, setServices] = useState<Option[]>([]);
  const [taxRates, setTaxRates] = useState<Option[]>([]);
  const [channels, setChannels] = useState<Option[]>([]);
  const [members, setMembers] = useState<Option[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get<{ rows: Array<{ id: string; name: string }> }>("/clients?pageSize=200").catch(() => ({ rows: [] })),
      api.get<{ rows: Array<{ id: string; name: string }> }>("/projects?pageSize=200").catch(() => ({ rows: [] })),
      api.get<Array<{ id: string; name: string }>>("/settings/stages").catch(() => []),
      api.get<{ rows: Array<{ id: string; name: string }> }>("/catalog/services?pageSize=200").catch(() => ({ rows: [] })),
      api.get<Array<{ id: string; name: string; code: string }>>("/settings/tax-rates").catch(() => []),
      api.get<Array<{ id: string; name: string }>>("/settings/categories?kind=CAMPAIGN_CHANNEL").catch(() => []),
      api.get<{ members: Array<{ userId: string; name: string }> }>("/team/members").catch(() => ({ members: [] })),
    ]).then(([c, p, s, sv, tr, ch, mb]) => {
      if (!alive) return;
      const map = (rows: Array<{ id: string; name: string }>): Option[] =>
        rows.map((r) => ({ value: r.id, label: r.name }));
      setClients(map(c.rows));
      setProjects(map(p.rows));
      setStages(map(s));
      setServices(map(sv.rows));
      setTaxRates(map(tr.filter((t) => !/-(CGST|SGST|IGST)$/.test(t.code))));
      setChannels(map(ch));
      setMembers(mb.members.map((m) => ({ value: m.userId, label: m.name })));
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { clients, projects, stages, services, taxRates, channels, members, loaded };
}
