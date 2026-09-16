"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { toast } from "@/components/toast";

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: { error?: { message?: string; details?: Array<{ path: string; message: string }> } } = {};
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const err = new Error(json?.error?.message ?? "Request failed") as Error & {
      details?: Array<{ path: string; message: string }>;
    };
    err.details = json?.error?.details;
    throw err;
  }
  return json;
}

export function AuthForm({
  fields,
  submitLabel,
  onSubmit,
  busyLabel,
  footer,
}: {
  fields: Array<{
    name: string;
    label: string;
    type?: string;
    autoComplete?: string;
    placeholder?: string;
    required?: boolean;
    hint?: string;
  }>;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  footer?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const fd = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    for (const f of fields) values[f.name] = String(fd.get(f.name) ?? "");
    try {
      await onSubmit(values);
    } catch (err) {
      const e2 = err as Error & { details?: Array<{ path: string; message: string }> };
      const map: Record<string, string> = {};
      for (const d of e2.details ?? []) map[d.path] = d.message;
      setErrors(map);
      toast("error", e2.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {fields.map((f) => (
        <Field key={f.name} label={f.label} error={errors[f.name]} hint={f.hint}>
          <Input
            name={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            placeholder={f.placeholder}
            required={f.required ?? true}
            minLength={f.type === "password" ? 8 : undefined}
          />
        </Field>
      ))}
      <Button type="submit" loading={busy} className="w-full">
        {busy ? busyLabel : submitLabel}
      </Button>
      {footer}
    </form>
  );
}

export function LoginForm() {
  const router = useRouter();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  if (mfaToken) {
    return (
      <AuthForm
        submitLabel="Verify"
        busyLabel="Verifying…"
        fields={[{ name: "code", label: "Authenticator code", placeholder: "123456", hint: "or a recovery code" }]}
        onSubmit={async (v) => {
          await post("/api/v1/auth/mfa", { token: mfaToken, code: v.code });
          router.push("/dashboard");
          router.refresh();
        }}
        footer={
          <p className="pt-2 text-center text-xs text-zinc-500">
            <button type="button" className="hover:underline" onClick={() => setMfaToken(null)}>← use different account</button>
          </p>
        }
      />
    );
  }
  return (
    <AuthForm
      submitLabel="Sign in"
      busyLabel="Signing in…"
      fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "email", placeholder: "you@company.in" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]}
      onSubmit={async (v) => {
        const res = await fetch("/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(v),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          const err = new Error(json?.error?.message ?? "Request failed") as Error & { details?: unknown };
          err.details = json?.error?.details;
          throw err;
        }
        if (json?.data?.mfaRequired && json?.meta?.token) {
          setMfaToken(json.meta.token as string);
          return;
        }
        router.push("/dashboard");
        router.refresh();
      }}
      footer={
        <div className="flex justify-between pt-2 text-xs text-zinc-500">
          <Link href="/forgot-password" className="hover:underline">
            Forgot password?
          </Link>
          <Link href="/register" className="font-medium text-zinc-700 hover:underline dark:text-zinc-300">
            Create workspace →
          </Link>
        </div>
      }
    />
  );
}

export function RegisterForm() {
  const router = useRouter();
  return (
    <AuthForm
      submitLabel="Create workspace"
      busyLabel="Creating…"
      fields={[
        { name: "orgName", label: "Agency / workspace name", placeholder: "e.g. AIthink Digital" },
        { name: "name", label: "Your name" },
        { name: "email", label: "Work email", type: "email", autoComplete: "email" },
        {
          name: "password",
          label: "Password",
          type: "password",
          autoComplete: "new-password",
          hint: "10+ chars with upper, lower, digit & symbol",
        },
      ]}
      onSubmit={async (v) => {
        await post("/api/v1/auth/register", v);
        router.push("/welcome");
        router.refresh();
      }}
      footer={
        <p className="pt-2 text-center text-xs text-zinc-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium hover:underline">
            Sign in
          </Link>
        </p>
      }
    />
  );
}

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const router = useRouter();
  if (sent) {
    return (
      <div className="space-y-4 text-sm">
        <p>
          If an account exists for that email, a 6-digit reset code is on its way (valid 15 minutes). In
          development without SMTP configured, the code is printed in the server log.
        </p>
        <Button onClick={() => router.push("/reset-password")}>Enter code</Button>
      </div>
    );
  }
  return (
    <AuthForm
      submitLabel="Send reset code"
      busyLabel="Sending…"
      fields={[{ name: "email", label: "Account email", type: "email" }]}
      onSubmit={async (v) => {
        await post("/api/v1/auth/forgot-password", v);
        setSent(true);
      }}
      footer={
        <p className="pt-2 text-center text-xs text-zinc-500">
          <Link href="/login" className="hover:underline">
            ← Back to sign in
          </Link>
        </p>
      }
    />
  );
}

export function ResetForm() {
  const router = useRouter();
  return (
    <AuthForm
      submitLabel="Reset password"
      busyLabel="Resetting…"
      fields={[
        { name: "email", label: "Email", type: "email" },
        { name: "code", label: "6-digit code", placeholder: "123456" },
        { name: "newPassword", label: "New password", type: "password", autoComplete: "new-password" },
      ]}
      onSubmit={async (v) => {
        await post("/api/v1/auth/reset-password", {
          email: v.email,
          code: v.code,
          newPassword: v.newPassword,
        });
        toast("success", "Password reset — sign in again");
        router.push("/login");
      }}
    />
  );
}

export function VerifyForm({ defaultEmail }: { defaultEmail?: string }) {
  const router = useRouter();
  return (
    <AuthForm
      submitLabel="Verify email"
      busyLabel="Verifying…"
      fields={[
        { name: "email", label: "Email", type: "email", ...(defaultEmail ? { placeholder: defaultEmail } : {}) },
        { name: "code", label: "6-digit code" },
      ]}
      onSubmit={async (v) => {
        await post("/api/v1/auth/verify-email", v);
        toast("success", "Email verified");
        router.push("/dashboard");
      }}
    />
  );
}

export function InviteForm({
  email,
  orgName,
  roleName,
  invitedBy,
  token,
}: {
  email: string;
  orgName: string;
  roleName: string;
  invitedBy: string;
  token: string;
}) {
  const router = useRouter();
  return (
    <AuthForm
      submitLabel="Join workspace"
      busyLabel="Joining…"
      fields={[
        { name: "name", label: "Your full name", placeholder: "Display name in OmniMark" },
        { name: "password", label: "Choose a password", type: "password", autoComplete: "new-password", hint: "10+ chars with upper, lower, digit & symbol" },
      ]}
      onSubmit={async (v) => {
        await post(`/api/v1/auth/invitations/${encodeURIComponent(token)}/accept`, {
          name: v.name,
          password: v.password,
        });
        router.push("/dashboard");
        router.refresh();
      }}
      footer={
        <div className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500 dark:bg-zinc-800/50">
          Invitation for <span className="font-medium text-zinc-700 dark:text-zinc-300">{email}</span> to join{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{orgName}</span> as{" "}
          {roleName}, invited by {invitedBy}.
        </div>
      }
    />
  );
}
