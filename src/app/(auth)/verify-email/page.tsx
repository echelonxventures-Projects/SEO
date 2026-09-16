import type { Metadata } from "next";
import { VerifyForm } from "../auth-forms";

export const metadata: Metadata = { title: "Verify email" };

export default function VerifyPage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Verify your email</h1>
      <p className="mb-6 text-sm text-zinc-500">Enter the 6-digit code we sent you.</p>
      <VerifyForm />
    </div>
  );
}
