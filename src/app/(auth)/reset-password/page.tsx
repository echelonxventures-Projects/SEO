import type { Metadata } from "next";
import { ResetForm } from "../auth-forms";

export const metadata: Metadata = { title: "Enter reset code" };

export default function ResetPage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Enter reset code</h1>
      <p className="mb-6 text-sm text-zinc-500">Check your inbox for the 6-digit code.</p>
      <ResetForm />
    </div>
  );
}
