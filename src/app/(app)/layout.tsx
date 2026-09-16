import type { ReactNode } from "react";
import { requireOrgPage } from "@/server/pages";
import { db } from "@/server/db";
import { Sidebar, Topbar, MobileNav } from "@/components/shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireOrgPage();
  const active = viewer.active!;
  const [plan, org] = await Promise.all([
    db.subscription.findFirst({
      where: { orgId: active.orgId, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
      orderBy: { createdAt: "desc" },
      include: { plan: { select: { name: true } } },
    }),
    db.organization.findUniqueOrThrow({ where: { id: active.orgId }, select: { name: true } }),
  ]);

  const permissions = [...active.permissions];
  return (
    <div className="min-h-screen">
      <Sidebar permissions={permissions} orgName={org.name} />
      <div className="lg:pl-60">
        <Topbar
          user={{ name: viewer.name, email: viewer.email }}
          orgs={viewer.orgs}
          activeOrg={{ orgId: active.orgId, orgName: active.orgName, roleCode: active.roleCode }}
          planName={plan?.plan.name ?? null}
        />
        <main className="mx-auto max-w-7xl px-4 py-6 pb-24 lg:px-8 lg:pb-10">{children}</main>
      </div>
      <MobileNav permissions={permissions} />
    </div>
  );
}
