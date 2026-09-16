import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveViewer, type Viewer } from "./context";

export async function pageViewer(): Promise<Viewer | null> {
  const h = await headers();
  return resolveViewer(h);
}

export async function requirePageViewer(): Promise<Viewer> {
  const viewer = await pageViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

/** Authenticated AND inside a workspace (else → onboarding/plan pick). */
export async function requireOrgPage(): Promise<Viewer> {
  const viewer = await requirePageViewer();
  if (!viewer.active) redirect("/welcome");
  return viewer;
}

export function can(viewer: Viewer, permission: string): boolean {
  return viewer.active?.permissions.has(permission) ?? false;
}
