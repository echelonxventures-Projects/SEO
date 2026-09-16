"use client";

import { useEffect, useState } from "react";

export type ToastKind = "success" | "error" | "info";
export type ToastMsg = { id: number; kind: ToastKind; text: string };

type Listener = (t: ToastMsg) => void;
const listeners = new Set<Listener>();
let nextId = 1;

export function toast(kind: ToastKind, text: string): void {
  const msg = { id: nextId++, kind, text };
  listeners.forEach((l) => l(msg));
}

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const listener: Listener = (t) => {
      setItems((cur) => [...cur, t]);
      setTimeout(() => setItems((cur) => cur.filter((i) => i.id !== t.id)), 5200);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${
            t.kind === "error"
              ? "border-red-500/30 bg-red-50 text-red-800 dark:bg-red-950/80 dark:text-red-200"
              : t.kind === "success"
                ? "border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200"
                : "border-zinc-500/30 bg-white text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
