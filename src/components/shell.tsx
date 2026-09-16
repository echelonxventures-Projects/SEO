"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Building2,
  CheckSquare,
  ChevronDown,
  CreditCard,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Gauge,
  Globe,
  LayoutDashboard,
  Link2,
  LogOut,
  Megaphone,
  Receipt,
  Search,
  Settings,
  Share2,
  Mail,
  CalendarClock,
  CalendarDays,
  Clock,
  Layers,
  UsersRound,
  RadioTower,
  BadgePercent,
  Network,
  QrCode,
  Fingerprint,
  Sparkles,
  Timer,
  Users,
  Wallet,
  CalendarRange,
  Compass,
  Armchair,
  HardHat,
  Zap,
  Library,
  LineChart,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string; icon: LucideIcon; permission: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "org.read" }],
  },
  {
    label: "Clients",
    items: [
      { href: "/clients", label: "Clients", icon: Building2, permission: "client.read" },
      { href: "/leads", label: "Leads", icon: Users, permission: "lead.read" },
    ],
  },
  {
    label: "Delivery",
    items: [
      { href: "/projects", label: "Projects", icon: FolderKanban, permission: "project.read" },
      { href: "/tasks", label: "Tasks", icon: CheckSquare, permission: "task.read" },
      { href: "/timesheets", label: "Timesheets", icon: Timer, permission: "time.read" },
      { href: "/expenses", label: "Expenses", icon: Wallet, permission: "expense.read" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/quotes", label: "Quotes", icon: FileText, permission: "quote.read" },
      { href: "/invoices", label: "Invoices", icon: Receipt, permission: "invoice.read" },
      { href: "/payments", label: "Payments", icon: CreditCard, permission: "payment.read" },
      { href: "/services", label: "Service catalog", icon: FileSpreadsheet, permission: "catalog.read" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/studio", label: "AI studio", icon: Sparkles, permission: "content.read" },
      { href: "/content", label: "Content", icon: CalendarClock, permission: "content.read" },
      { href: "/blogs", label: "Blog posts", icon: FileText, permission: "content.read" },
      { href: "/social", label: "Social channels", icon: Share2, permission: "social.read" },
      { href: "/email", label: "Email marketing", icon: Mail, permission: "email.read" },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone, permission: "campaign.read" },
      { href: "/channels", label: "Channels", icon: Layers, permission: "campaign.read" },
      { href: "/audiences", label: "Audiences", icon: UsersRound, permission: "campaign.read" },
      { href: "/offers", label: "Offers", icon: BadgePercent, permission: "campaign.read" },
      { href: "/seo/keywords", label: "Rankings", icon: Gauge, permission: "seo.read" },
      { href: "/seo/audits", label: "Site audits", icon: Globe, permission: "seo.read" },
      { href: "/seo/backlinks", label: "Backlinks", icon: Link2, permission: "seo.read" },
      { href: "/links", label: "Tracked links", icon: QrCode, permission: "link.read" },
      { href: "/sites", label: "Sites & pixels", icon: Fingerprint, permission: "site.read" },
    ],
  },
  {
    label: "Temporal",
    items: [
      { href: "/temporal", label: "Time platform", icon: Compass, permission: "temporal.read" },
      { href: "/temporal/patterns", label: "Patterns & DSL", icon: CalendarRange, permission: "temporal.read" },
      { href: "/temporal/calendars", label: "Calendars", icon: CalendarDays, permission: "temporal.read" },
      { href: "/temporal/appointments", label: "Appointments", icon: Clock, permission: "appointment.read" },
      { href: "/temporal/resources", label: "Resources", icon: Armchair, permission: "resource.read" },
      { href: "/temporal/workforce", label: "Workforce", icon: HardHat, permission: "workforce.read" },
      { href: "/temporal/triggers", label: "Triggers", icon: Zap, permission: "temporal.read" },
      { href: "/temporal/library", label: "Temporal library", icon: Library, permission: "temporal.read" },
      { href: "/temporal/analytics", label: "Temporal analytics", icon: LineChart, permission: "temporal.read" },
      { href: "/temporal/governance", label: "Governance", icon: ShieldCheck, permission: "temporal.read" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3, permission: "report.read" },
      { href: "/activity", label: "Activity", icon: Search, permission: "activity.read" },
      { href: "/events", label: "Events & webhooks", icon: RadioTower, permission: "activity.read" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/team", label: "Team", icon: Users, permission: "member.read" },
      { href: "/billing", label: "Billing", icon: CreditCard, permission: "subscription.read" },
      { href: "/system", label: "System", icon: Network, permission: "settings.read" },
      { href: "/settings", label: "Settings", icon: Settings, permission: "settings.read" },
    ],
  },
];

function useVisibleNav(permissions: string[]) {
  const set = new Set(permissions);
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => set.has(i.permission)) }))
    .filter((g) => g.items.length > 0);
}

export type Brand = {
  productName: string;
  primaryColor: string;
  logoUrl: string | null;
  hidePoweredBy: boolean;
};

function tr(strings: Record<string, string>, key: string, fallback: string): string {
  return strings[key] ?? fallback;
}

export function Sidebar({
  permissions,
  orgName,
  brand = { productName: "OmniMark", primaryColor: "#18181b", logoUrl: null, hidePoweredBy: false },
  strings = {},
}: {
  permissions: string[];
  orgName: string;
  brand?: Brand;
  strings?: Record<string, string>;
}) {
  const pathname = usePathname();
  const groups = useVisibleNav(permissions);
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:flex">
      <div className="flex h-14 items-center gap-2 border-b border-zinc-100 px-4 dark:border-zinc-800">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ background: brand.primaryColor }}>
            {brand.logoUrl ? <img src={brand.logoUrl} alt="" className="h-4 w-4" /> : <Sparkles className="h-3.5 w-3.5" />}
          </span>
          {tr(strings, "brand.productName", brand.productName)}
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {orgName && (
          <p className="mb-3 truncate px-2 text-xs font-medium uppercase tracking-wider text-zinc-400">{orgName}</p>
        )}
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{tr(strings, `navgroup.${group.label.toLowerCase()}`, group.label)}</p>
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "mb-0.5 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors",
                    active
                      ? "bg-zinc-900 font-medium text-white dark:bg-white dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {tr(strings, `nav.${item.href.replace(/^\//, "").replace(/\//g, ".") || "home"}`, item.label)}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

export function Topbar({
  user,
  orgs,
  activeOrg,
  planName,
}: {
  user: { name: string; email: string };
  orgs: Array<{ orgId: string; orgName: string }>;
  activeOrg: { orgId: string; orgName: string; roleCode: string } | null;
  planName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function switchOrg(orgId: string) {
    await fetch(`/api/v1/auth/org/switch/${orgId}`, { method: "POST" });
    router.refresh();
    setOpen(false);
  }

  async function signOut() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80 lg:px-6">
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <span className="max-w-40 truncate font-medium">{activeOrg?.orgName ?? "No workspace"}</span>
          {activeOrg && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800">
              {activeOrg.roleCode}
            </span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
        </button>
        {open && (
          <div className="absolute left-0 top-11 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Workspaces
            </p>
            {orgs.map((o) => (
              <button
                key={o.orgId}
                onClick={() => switchOrg(o.orgId)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  o.orgId === activeOrg?.orgId && "font-medium",
                )}
              >
                <span className="truncate">{o.orgName}</span>
                {o.orgId === activeOrg?.orgId && <span className="text-emerald-500">✓</span>}
              </button>
            ))}
            <Link
              href="/register"
              className="mt-1 block rounded-lg border-t border-zinc-100 px-2.5 py-2 text-sm text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
            >
              + Create another workspace
            </Link>
          </div>
        )}
      </div>
      {planName && (
        <span className="hidden items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-600 sm:inline-flex dark:text-violet-400">
          {planName} plan
        </span>
      )}
      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium leading-4">{user.name}</p>
          <p className="text-[11px] leading-4 text-zinc-400">{user.email}</p>
        </div>
        <button
          onClick={signOut}
          title="Sign out"
          className="rounded-lg border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

export function MobileNav({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const groups = useVisibleNav(permissions);
  const items = groups.flatMap((g) => g.items);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-zinc-200 bg-white px-2 py-1.5 lg:hidden dark:border-zinc-800 dark:bg-zinc-900">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-w-16 flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px]",
              active ? "text-zinc-900 dark:text-white" : "text-zinc-400",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
