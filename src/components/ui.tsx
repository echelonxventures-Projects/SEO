"use client";

import {
  createContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import { Loader2, X } from "lucide-react";
import { toast } from "./toast";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200",
  secondary: "bg-zinc-100 text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700",
  ghost: "bg-transparent text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
  danger: "bg-red-600 text-white hover:bg-red-500",
  outline: "border border-zinc-300 bg-transparent text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

/**
 * Button that runs an async action with automatic busy state and toast.
 * `fn` throwing an Error surfaces message; resolving calls onDone.
 */
export function ActionButton({
  action,
  onDone,
  confirm,
  children,
  variant = "secondary",
  size = "sm",
  className,
}: {
  action: () => Promise<unknown>;
  onDone?: () => void;
  confirm?: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      loading={busy}
      className={className}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        try {
          await action();
          toast("success", "Done");
          onDone?.();
        } catch (e) {
          toast("error", e instanceof Error ? e.message : "Action failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Card / layout primitives
// ---------------------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-14 text-center">
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</p>
      {hint && <p className="text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>}
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-zinc-400">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-red-600">{error}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputClass, "min-h-20", className)} />;
}

export function Select({
  className,
  options,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select {...props} className={cn(inputClass, "appearance-auto", className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" {...props} className="h-4 w-4 rounded border-zinc-300" />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Badge & table helpers
// ---------------------------------------------------------------------------

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", className)}>
      {children}
    </span>
  );
}

export function TWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn("whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("border-b border-zinc-100 px-4 py-2.5 align-middle dark:border-zinc-800/60", className)}>{children}</td>;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className={cn("w-full rounded-xl bg-white shadow-2xl dark:bg-zinc-900", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form modal context (submit state sharing)
// ---------------------------------------------------------------------------

export const FormBusyContext = createContext<{ busy: boolean }>({ busy: false });
export function useFormBusy(onDone?: () => void) {
  return useAsyncForm(onDone);
}

// ---------------------------------------------------------------------------
// Pagination (URL-driven, server-render friendly)
// ---------------------------------------------------------------------------

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (p: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-3 text-xs text-zinc-500">
      <span>
        Page {page} of {pages} · {total} records
      </span>
      <div className="ml-auto flex gap-1">
        {page > 1 && (
          <a href={hrefFor(page - 1)} className="rounded border px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            Prev
          </a>
        )}
        {page < pages && (
          <a href={hrefFor(page + 1)} className="rounded border px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            Next
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// useAsyncForm — shared mutation plumbing for modal forms
// ---------------------------------------------------------------------------

export function useAsyncForm(onDone?: () => void) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      if (mounted.current) {
        toast("success", "Saved");
        onDone?.();
      }
      return true;
    } catch (e: unknown) {
      const err = e as { code?: string; details?: Array<{ path: string; message: string }>; message?: string };
      if (err?.details && Array.isArray(err.details) && mounted.current) {
        const map: Record<string, string> = {};
        for (const d of err.details) map[d.path] = d.message;
        setErrors(map);
      }
      if (mounted.current) toast("error", e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, errors, setErrors, run };
}
