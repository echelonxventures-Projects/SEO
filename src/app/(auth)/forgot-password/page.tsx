import type { Metadata } from "next";
import { ForgotForm } from "../auth-forms";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Reset password</h1>
      <p className="mb-6 text-sm text-zinc-500">We&apos;ll email you a one-time code.</p>
      <ForgotForm />
    </div>
  );
}
