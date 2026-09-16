"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, TWrap, Th, Td } from "@/components/ui";
import { CrudFormModal, StatusBadge, type FieldDef } from "@/components/crud";
import { fmtMoney, fmtMinutes, fmtDate } from "@/lib/format";
import { toast } from "@/components/toast";
import { cn } from "@/lib/utils";

type Task = { id: string; title: string; status: string; priority: string; dueDate: string | null; assignee: { name: string } | null };
type Entry = { id: string; date: string; minutes: number; billable: boolean; description: string | null; user: { name: string }; task: { title: string } | null };
type Expense = { id: string; date: string; amountMinor: number | bigint; billable: boolean; description: string | null; category: { name: string } | null };

const FLOW: Record<string, string[]> = {
  BACKLOG: ["TODO", "CANCELLED"],
  TODO: ["IN_PROGRESS", "BLOCKED", "CANCELLED"],
  IN_PROGRESS: ["IN_REVIEW", "BLOCKED", "TODO", "CANCELLED"],
  IN_REVIEW: ["DONE", "IN_PROGRESS", "CANCELLED"],
  BLOCKED: ["TODO", "IN_PROGRESS", "CANCELLED"],
  DONE: ["IN_PROGRESS"],
  CANCELLED: ["TODO"],
};

export function ProjectDelivery({
  projectId,
  permissions,
  members,
}: {
  projectId: string;
  projectName: string;
  permissions: string[];
  hourlyRate: number | null;
  counts: Record<string, number>;
  members: Array<{ id: string; name: string }>;
}) {
  const [tab, setTab] = useState<"tasks" | "time" | "expenses">("tasks");
  const can = (p: string) => permissions.includes(p);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [time, setTime] = useState<Entry[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState(false);
  const [newTime, setNewTime] = useState(false);
  const [newExpense, setNewExpense] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, tm, ex] = await Promise.all([
        api.get<{ rows: Task[] }>(`/tasks?projectId=${projectId}&pageSize=100`),
        api.get<{ rows: Entry[] }>(`/time?projectId=${projectId}&pageSize=100`),
        api.get<{ rows: Expense[] }>(`/expenses?projectId=${projectId}&pageSize=100`),
      ]);
      setTasks(t.rows);
      setTime(tm.rows);
      setExpenses(ex.rows);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function advance(task: Task) {
    const next = FLOW[task.status]?.[0];
    if (!next) return;
    try {
      await api.patch(`/tasks/${task.id}`, { status: next });
      load();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Failed");
    }
  }

  const taskFields: FieldDef[] = [
    { name: "title", label: "Title", required: true },
    { name: "priority", label: "Priority", kind: "select", default: "MEDIUM", options: [
      { value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }, { value: "URGENT", label: "Urgent" },
    ], half: true },
    { name: "assigneeId", label: "Assignee", kind: "select", half: true, options: [{ value: "", label: "Unassigned" }, ...members.map((m) => ({ value: m.id, label: m.name }))] },
    { name: "dueDate", label: "Due date", kind: "date", half: true },
    { name: "description", label: "Description", kind: "textarea" },
  ];
  const timeFields: FieldDef[] = [
    { name: "date", label: "Date", kind: "date", required: true, half: true },
    { name: "minutes", label: "Minutes", kind: "number", required: true, default: 60, half: true },
    { name: "billable", label: "Billable", kind: "checkbox", default: true },
    { name: "description", label: "What did you work on?", kind: "textarea" },
  ];
  const expFields: FieldDef[] = [
    { name: "date", label: "Date", kind: "date", required: true, half: true },
    { name: "amount", label: "Amount", kind: "money", required: true, half: true },
    { name: "billable", label: "Recharge to client", kind: "checkbox", default: true },
    { name: "description", label: "Description", kind: "textarea" },
  ];

  const tabs = [
    { id: "tasks" as const, label: `Tasks (${tasks.length})` },
    { id: "time" as const, label: `Time (${fmtMinutes(time.reduce((a, t) => a + t.minutes, 0))})` },
    { id: "expenses" as const, label: `Expenses (${expenses.length})` },
  ];

  return (
    <Card>
      <CardHeader
        title="Delivery"
        description="Work, billable time and pass-through costs"
        actions={
          <div className="flex gap-2">
            {tab === "tasks" && can("task.write") && <Button size="sm" onClick={() => setNewTask(true)}>Add task</Button>}
            {tab === "time" && can("time.write") && <Button size="sm" onClick={() => setNewTime(true)}>Log time</Button>}
            {tab === "expenses" && can("expense.write") && <Button size="sm" onClick={() => setNewExpense(true)}>Add expense</Button>}
          </div>
        }
      />
      <div className="flex gap-1 border-b border-zinc-100 px-3 dark:border-zinc-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab === t.id ? "border-zinc-900 text-zinc-900 dark:border-white dark:text-white" : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3 p-6">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>
      ) : tab === "tasks" ? (
        tasks.length === 0 ? (
          <p className="p-6 text-sm text-zinc-400">No tasks yet.</p>
        ) : (
          <TWrap>
            <thead><tr><Th>Task</Th><Th>Assignee</Th><Th>Priority</Th><Th>Status</Th><Th className="text-right">Next</Th></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <Td><span className="font-medium">{t.title}</span>{t.dueDate && <span className="ml-2 text-xs text-zinc-400">{fmtDate(t.dueDate)}</span>}</Td>
                  <Td className="text-zinc-500">{t.assignee?.name ?? "—"}</Td>
                  <Td><StatusBadge value={t.priority} /></Td>
                  <Td><StatusBadge value={t.status} /></Td>
                  <Td className="text-right">{FLOW[t.status]?.[0] && can("task.write") && (
                    <button onClick={() => advance(t)} className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">→ {FLOW[t.status][0].toLowerCase().replace("_", " ")}</button>
                  )}</Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )
      ) : tab === "time" ? (
        time.length === 0 ? <p className="p-6 text-sm text-zinc-400">No time logged.</p> : (
          <TWrap>
            <thead><tr><Th>Date</Th><Th>Member</Th><Th>Task</Th><Th>Time</Th><Th>Billable</Th></tr></thead>
            <tbody>
              {time.map((t) => (
                <tr key={t.id}>
                  <Td className="text-zinc-500">{fmtDate(t.date)}</Td>
                  <Td>{t.user.name}</Td>
                  <Td className="text-zinc-500">{t.task?.title ?? "—"}</Td>
                  <Td className="font-medium">{fmtMinutes(t.minutes)}</Td>
                  <Td>{t.billable ? "Yes" : "No"}</Td>
                </tr>
              ))}
            </tbody>
          </TWrap>
        )
      ) : expenses.length === 0 ? <p className="p-6 text-sm text-zinc-400">No expenses.</p> : (
        <TWrap>
          <thead><tr><Th>Date</Th><Th>Category</Th><Th>Description</Th><Th>Amount</Th></tr></thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id}>
                <Td className="text-zinc-500">{fmtDate(e.date)}</Td>
                <Td className="text-zinc-500">{e.category?.name ?? "—"}</Td>
                <Td>{e.description ?? ""}</Td>
                <Td className="font-medium">{fmtMoney(Number(e.amountMinor))}</Td>
              </tr>
            ))}
          </tbody>
        </TWrap>
      )}

      <CrudFormModal open={newTask} onClose={() => setNewTask(false)} title="New task" fields={taskFields} onSubmit={async (p) => { await api.post("/tasks", { ...p, projectId }); setNewTask(false); load(); }} />
      <CrudFormModal open={newTime} onClose={() => setNewTime(false)} title="Log time" fields={timeFields} onSubmit={async (p) => { await api.post("/time", { ...p, projectId }); setNewTime(false); load(); }} />
      <CrudFormModal open={newExpense} onClose={() => setNewExpense(false)} title="Add expense" fields={expFields} onSubmit={async (p) => { await api.post("/expenses", { ...p, projectId }); setNewExpense(false); load(); }} />
    </Card>
  );
}
