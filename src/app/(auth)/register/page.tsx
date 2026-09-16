import type { Metadata } from "next";
import { RegisterForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create workspace" };

export default function RegisterPage() {
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Create your workspace</h1>
      <p className="mb-6 text-sm text-zinc-500">One account, unlimited clients. 14-day trial included.</p>
      <RegisterForm />
    </div>
  );
}
