import { redirect } from "next/navigation";
import { pageViewer } from "@/server/pages";

export default async function RootPage() {
  const viewer = await pageViewer();
  if (!viewer) redirect("/login");
  if (!viewer.active) redirect("/welcome");
  redirect("/dashboard");
}
