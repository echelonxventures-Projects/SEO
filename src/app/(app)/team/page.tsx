"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, Modal, PageHeader, Select, TWrap, Th, Td, Input, Field } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { toast } from "@/components/toast";
import { Fragment } from "react";
import { Check, X } from "lucide-react";

type Member = { id: string; userId: string; name: string; email: string; roleCode: string; roleName: string; roleRank: number; joinedAt: string };
type Invite = { id: string; email: string; roleCode: string; expiresAt: string };
type Catalog = { permissions: Array<{ id: string; code: string; module: string; name: string }>; roles: Array<{ code: string; name: string; rank: number; permissions: string[] }> };

const INVITABLE = [
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "MEMBER", label: "Member" },
  { value: "VIEWER", label: "Viewer" },
];

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, c] = await Promise.all([
        api.get<{ members: Member[]; invitations: Invite[] }>("/team/members"),
        api.get<Catalog>("/settings/permissions"),
      ]);
      setMembers(m.members);
      setInvites(m.invitations);
      setCatalog(c);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PageHeader
        title="Team"
        description="Who's in this workspace and what they can access."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowMatrix(true)}>Permission matrix</Button>
            <Button size="sm" onClick={() => setInviteOpen(true)}>Invite member</Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardHeader title="Members" description={`${members.length} people`} />
        {loading ? (
          <div className="p-4 text-sm text-zinc-400">Loading…</div>
        ) : (
          <TWrap>
            <thead><tr><Th>Member</Th><Th>Role</Th><Th>Joined</Th><Th className="text-right"></Th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <Td><p className="font-medium">{m.name}</p><p className="text-xs text-zinc-400">{m.email}</p></Td>
                  <Td>
                    <Select
                      className="w-36"
                      value={m.roleCode}
                      disabled={m.roleCode === "OWNER"}
                      onChange={async (e) => {
                        try {
                          await api.post(`/team/members/${m.id}/role`, { roleCode: e.target.value });
                          toast("success", "Role updated");
                          load();
                        } catch (err) {
                          toast("error", err instanceof Error ? err.message : "Failed");
                          load();
                        }
                      }}
                      options={[{ value: "OWNER", label: "Owner" }, ...INVITABLE.map((r) => ({ value: r.value, label: r.label }))]}
                    />
                  </Td>
                  <Td className="text-zinc-500">{fmtDate(m.joinedAt)}</Td>
                  <Td className="text-right">
                    {m.roleCode !== "OWNER" && (
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Remove ${m.name} from the workspace?`)) return;
                          try {
                            await api.del(`/team/members/${m.id}`);
                            toast("success", "Member removed");
                            load();
                          } catch (err) {
                            toast("error", err instanceof Error ? err.message : "Failed");
                          }
                        }}
                        className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                      >
                        Remove
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )}
      </Card>

      {invites.length > 0 && (
        <Card>
          <CardHeader title="Pending invitations" />
          <TWrap>
            <thead><tr><Th>Email</Th><Th>Role</Th><Th>Expires</Th><Th className="text-right"></Th></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">{i.email}</Td>
                  <Td className="text-zinc-500">{i.roleCode}</Td>
                  <Td className="text-zinc-500">{fmtDate(i.expiresAt)}</Td>
                  <Td className="text-right">
                    <button onClick={async () => { try { await api.del(`/team/invitations/${i.id}`); toast("success", "Revoked"); load(); } catch (e) { toast("error", e instanceof Error ? e.message : "Failed"); } }} className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Revoke</button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        </Card>
      )}

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} onDone={load} />}
      {showMatrix && catalog && <MatrixModal catalog={catalog} onClose={() => setShowMatrix(false)} />}
    </div>
  );
}

function InviteModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Invite member">
      <div className="space-y-3">
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.in" /></Field>
        <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)} options={INVITABLE} /></Field>
        <p className="text-xs text-zinc-400">They&apos;ll receive an email with a 7-day activation link.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.post("/team/invitations", { email, roleCode: role });
              toast("success", "Invitation sent");
              onDone();
              onClose();
            } catch (e) {
              toast("error", e instanceof Error ? e.message : "Failed");
              setBusy(false);
            }
          }}>Send invite</Button>
        </div>
      </div>
    </Modal>
  );
}

function MatrixModal({ catalog, onClose }: { catalog: Catalog; onClose: () => void }) {
  const modules = Array.from(new Set(catalog.permissions.map((p) => p.module)));
  return (
    <Modal open onClose={onClose} title="Permission matrix" wide>
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white px-2 py-2 text-left dark:bg-zinc-900">Capability</th>
              {catalog.roles.map((r) => (
                <th key={r.code} className="px-2 py-2 text-center font-semibold">{r.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((mod) => (
              <Fragment key={mod}>
                <tr><td colSpan={catalog.roles.length + 1} className="bg-zinc-50 px-2 py-1.5 pt-3 font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-800/40">{mod}</td></tr>
                {catalog.permissions.filter((p) => p.module === mod).map((p) => (
                  <tr key={p.code} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="sticky left-0 bg-white px-2 py-1.5 dark:bg-zinc-900">{p.name}</td>
                    {catalog.roles.map((r) => (
                      <td key={r.code} className="px-2 py-1.5 text-center">
                        {r.permissions.includes(p.code) ? <Check className="mx-auto h-3.5 w-3.5 text-emerald-600" /> : <X className="mx-auto h-3.5 w-3.5 text-zinc-300" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
