import { z } from "zod";
import { db } from "../db";
import { AppError, ErrorCodes } from "../errors";
import { dateSchema, enumFilter, longText, moneySchema, nameish, paginationSchema, skipTake, urlish } from "../schemas";
import { toMinor } from "../money";
import type { Ctx } from "./common";
import { assertCapacity, assertWritable, audit, requireOwned } from "./common";

const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
const TASK_STATUSES = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "BLOCKED", "DONE", "CANCELLED"] as const;
const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export const projectSchema = z.object({
  clientId: z.string().min(1),
  name: nameish,
  summary: longText.nullable().optional(),
  typeId: z.string().max(64).nullable().optional(),
  startDate: dateSchema.nullable().optional(),
  endDate: dateSchema.nullable().optional(),
  budget: moneySchema.nullable().optional(),
  hourlyRate: moneySchema.nullable().optional(),
  retainerMonthly: moneySchema.nullable().optional(),
  domainUrl: urlish.nullable().optional(),
});

export async function listProjects(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const status = query.get("status");
  const clientId = query.get("clientId");
  const where = {
    orgId: ctx.orgId,
    status: enumFilter(status, PROJECT_STATUSES),
    ...(clientId ? { clientId } : {}),
    ...(p.q ? { name: { contains: p.q, mode: "insensitive" as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.project.findMany({
      where,
      ...skipTake(p),
      orderBy: { updatedAt: "desc" },
      include: {
        client: { select: { id: true, name: true } },
        currency: true,
        owner: { select: { id: true, name: true } },
        _count: { select: { tasks: true, members: true } },
      },
    }),
    db.project.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function createProject(ctx: Ctx, input: unknown) {
  const data = projectSchema.parse(input);
  await assertWritable(ctx.orgId);
  const count = await db.project.count({ where: { orgId: ctx.orgId } });
  await assertCapacity(ctx.orgId, "PROJECTS", count + 1);
  await requireOwned(await db.client.findUnique({ where: { id: data.clientId } }), "Client", ctx.orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const project = await db.project.create({
    data: {
      orgId: ctx.orgId,
      clientId: data.clientId,
      name: data.name,
      summary: data.summary ?? null,
      typeId: data.typeId ?? null,
      ownerId: ctx.userId,
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      budgetMinor: data.budget != null ? toMinor(data.budget) : null,
      hourlyRateMinor: data.hourlyRate != null ? toMinor(data.hourlyRate) : null,
      retainerMonthlyMinor: data.retainerMonthly != null ? toMinor(data.retainerMonthly) : null,
      domainUrl: data.domainUrl ?? null,
      currencyCode: org.defaultCurrencyCode,
    },
  });
  await db.projectMember.create({ data: { projectId: project.id, userId: ctx.userId } });
  await audit(db, ctx, "project.created", "PROJECT", project.id, { name: project.name });
  return project;
}

export async function getProject(ctx: Ctx, id: string) {
  const project = await requireOwned(
    await db.project.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, currency: true } },
        currency: true,
        type: true,
        owner: { select: { id: true, name: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    }),
    "Project",
    ctx.orgId,
  );
  const [taskGroups, timeAgg, expenseAgg, unbilledTime] = await Promise.all([
    db.task.groupBy({ by: ["status"], where: { projectId: id }, _count: true }),
    db.timeEntry.aggregate({ where: { projectId: id }, _sum: { minutes: true } }),
    db.expense.aggregate({ where: { projectId: id, billable: true, invoiceLineId: null }, _sum: { amountMinor: true } }),
    db.timeEntry.aggregate({
      where: { projectId: id, billable: true, invoiceLineId: null },
      _sum: { minutes: true },
      _count: true,
    }),
  ]);
  return { project, taskGroups, totals: { minutesLogged: timeAgg._sum.minutes ?? 0, unbilledExpenseMinor: expenseAgg._sum.amountMinor ?? 0n, unbilledMinutes: unbilledTime._sum.minutes ?? 0 } };
}

export async function updateProject(ctx: Ctx, id: string, input: unknown) {
  const data = projectSchema
    .partial()
    .extend({ status: z.enum(PROJECT_STATUSES).optional() })
    .parse(input);
  await requireOwned(await db.project.findUnique({ where: { id } }), "Project", ctx.orgId);
  const project = await db.project.update({
    where: { id },
    data: {
      name: data.name,
      summary: data.summary,
      typeId: data.typeId,
      clientId: data.clientId,
      status: data.status,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      budgetMinor: data.budget != null ? toMinor(data.budget) : undefined,
      hourlyRateMinor: data.hourlyRate != null ? toMinor(data.hourlyRate) : undefined,
      retainerMonthlyMinor: data.retainerMonthly != null ? toMinor(data.retainerMonthly) : undefined,
      domainUrl: data.domainUrl,
    },
  });
  await audit(db, ctx, "project.updated", "PROJECT", id);
  return project;
}

export async function setProjectMembers(ctx: Ctx, projectId: string, input: unknown) {
  const { userIds } = z.object({ userIds: z.array(z.string()).max(100) }).parse(input);
  await requireOwned(await db.project.findUnique({ where: { id: projectId } }), "Project", ctx.orgId);
  const members = await db.membership.findMany({ where: { orgId: ctx.orgId, userId: { in: userIds } } });
  if (members.length !== new Set(userIds).size) {
    throw new AppError(ErrorCodes.VALIDATION, "All user ids must be active members of this workspace");
  }
  await db.$transaction([
    db.projectMember.deleteMany({ where: { projectId, userId: { notIn: userIds } } }),
    ...members.map((m) =>
      db.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: m.userId } },
        create: { projectId, userId: m.userId },
        update: {},
      }),
    ),
  ]);
  await audit(db, ctx, "project.members_set", "PROJECT", projectId, { count: userIds.length });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const taskSchema = z.object({
  projectId: z.string().min(1),
  title: nameish,
  description: longText.nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeId: z.string().max(64).nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
  estimatedMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  serviceItemId: z.string().max(64).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function listTasks(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const projectId = query.get("projectId");
  const status = query.get("status");
  const assigneeId = query.get("assigneeId");
  const where = {
    orgId: ctx.orgId,
    ...(projectId ? { projectId } : {}),
    status: enumFilter(status, TASK_STATUSES),
    ...(assigneeId ? { assigneeId } : {}),
    ...(p.q ? { title: { contains: p.q, mode: "insensitive" as const } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.task.findMany({
      where,
      ...skipTake(p),
      orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { dueDate: "asc" }],
      include: {
        project: { select: { id: true, name: true, client: { select: { name: true } } } },
        assignee: { select: { id: true, name: true } },
      },
    }),
    db.task.count({ where }),
  ]);
  return { rows, total, page: p.page, pageSize: p.pageSize };
}

export async function createTask(ctx: Ctx, input: unknown) {
  const data = taskSchema.parse(input);
  await requireOwned(await db.project.findUnique({ where: { id: data.projectId } }), "Project", ctx.orgId);
  if (data.assigneeId) {
    const m = await db.membership.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: data.assigneeId } } });
    if (!m) throw new AppError(ErrorCodes.VALIDATION, "Assignee is not a member of this workspace");
  }
  const task = await db.task.create({
    data: {
      orgId: ctx.orgId,
      projectId: data.projectId,
      title: data.title,
      description: data.description ?? null,
      priority: data.priority,
      assigneeId: data.assigneeId ?? null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      estimatedMinutes: data.estimatedMinutes ?? null,
      serviceItemId: data.serviceItemId ?? null,
      sortOrder: data.sortOrder ?? 0,
    },
  });
  await audit(db, ctx, "task.created", "TASK", task.id);
  return task;
}

const TASK_FLOW: Record<string, string[]> = {
  BACKLOG: ["TODO", "CANCELLED"],
  TODO: ["IN_PROGRESS", "BLOCKED", "CANCELLED"],
  IN_PROGRESS: ["IN_REVIEW", "BLOCKED", "TODO", "CANCELLED"],
  IN_REVIEW: ["DONE", "IN_PROGRESS", "CANCELLED"],
  BLOCKED: ["TODO", "IN_PROGRESS", "CANCELLED"],
  DONE: ["IN_PROGRESS"],
  CANCELLED: ["TODO"],
};

export async function updateTask(ctx: Ctx, id: string, input: unknown) {
  const data = taskSchema.partial().extend({ status: z.enum(TASK_STATUSES).optional() }).omit({ projectId: true }).parse(input);
  const task = await requireOwned(await db.task.findUnique({ where: { id } }), "Task", ctx.orgId);
  if (data.status && data.status !== task.status) {
    const allowed = TASK_FLOW[task.status] ?? [];
    if (!allowed.includes(data.status)) {
      throw new AppError(
        ErrorCodes.ILLEGAL_STATE,
        `Cannot move task from ${task.status} to ${data.status}. Allowed: ${allowed.join(", ") || "none"}`,
      );
    }
  }
  const updated = await db.task.update({
    where: { id },
    data: {
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      assigneeId: data.assigneeId,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      estimatedMinutes: data.estimatedMinutes,
      completedAt: data.status === "DONE" ? new Date() : data.status ? null : undefined,
      sortOrder: data.sortOrder,
    },
  });
  await audit(db, ctx, "task.updated", "TASK", id, { status: data.status });
  return updated;
}

export async function deleteTask(ctx: Ctx, id: string) {
  await requireOwned(await db.task.findUnique({ where: { id } }), "Task", ctx.orgId);
  await db.task.delete({ where: { id } });
  await audit(db, ctx, "task.deleted", "TASK", id);
}

// ---------------------------------------------------------------------------
// Time tracking
// ---------------------------------------------------------------------------

export const timeEntrySchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().max(64).nullable().optional(),
  date: dateSchema,
  minutes: z.number().int().min(1).max(24 * 60 * 7),
  billable: z.boolean().optional(),
  rate: moneySchema.nullable().optional(),
  description: longText.nullable().optional(),
});

export async function createTimeEntry(ctx: Ctx, input: unknown) {
  const data = timeEntrySchema.parse(input);
  await requireOwned(await db.project.findUnique({ where: { id: data.projectId } }), "Project", ctx.orgId);
  if (data.taskId) {
    const task = await requireOwned(await db.task.findUnique({ where: { id: data.taskId } }), "Task", ctx.orgId);
    if (task.projectId !== data.projectId) throw new AppError(ErrorCodes.VALIDATION, "Task does not belong to this project");
  }
  const entry = await db.timeEntry.create({
    data: {
      orgId: ctx.orgId,
      projectId: data.projectId,
      taskId: data.taskId ?? null,
      userId: ctx.userId,
      date: new Date(data.date),
      minutes: data.minutes,
      billable: data.billable ?? true,
      rateMinor: data.rate != null ? toMinor(data.rate) : null,
      description: data.description ?? null,
    },
  });
  await audit(db, ctx, "time.logged", "PROJECT", data.projectId, { minutes: data.minutes });
  return entry;
}

export async function updateTimeEntry(ctx: Ctx, id: string, input: unknown) {
  const data = timeEntrySchema.partial().omit({ projectId: true, taskId: true }).parse(input);
  const entry = await requireOwned(await db.timeEntry.findUnique({ where: { id } }), "Time entry", ctx.orgId);
  if (entry.invoiceLineId) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "This time entry is already billed on an invoice");
  }
  return db.timeEntry.update({
    where: { id },
    data: {
      date: data.date ? new Date(data.date) : undefined,
      minutes: data.minutes,
      billable: data.billable,
      rateMinor: data.rate != null ? toMinor(data.rate) : undefined,
      description: data.description,
    },
  });
}

export async function deleteTimeEntry(ctx: Ctx, id: string) {
  const entry = await requireOwned(await db.timeEntry.findUnique({ where: { id } }), "Time entry", ctx.orgId);
  if (entry.invoiceLineId) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "This time entry is already billed on an invoice");
  }
  await db.timeEntry.delete({ where: { id } });
  await audit(db, ctx, "time.deleted", "PROJECT", entry.projectId);
}

export async function listTimeEntries(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const projectId = query.get("projectId");
  const userId = query.get("userId");
  const from = query.get("from");
  const to = query.get("to");
  const where = {
    orgId: ctx.orgId,
    ...(projectId ? { projectId } : {}),
    ...(userId ? { userId } : {}),
    ...(from || to
      ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {}),
  };
  const [rows, total, sum] = await Promise.all([
    db.timeEntry.findMany({
      where,
      ...skipTake(p),
      orderBy: { date: "desc" },
      include: {
        user: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, client: { select: { name: true } } } },
        task: { select: { id: true, title: true } },
      },
    }),
    db.timeEntry.count({ where }),
    db.timeEntry.aggregate({ where, _sum: { minutes: true } }),
  ]);
  return { rows, total, minutes: sum._sum.minutes ?? 0, page: p.page, pageSize: p.pageSize };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const expenseSchema = z.object({
  projectId: z.string().min(1),
  categoryId: z.string().max(64).nullable().optional(),
  date: dateSchema,
  amount: moneySchema,
  billable: z.boolean().optional(),
  description: longText.nullable().optional(),
});

export async function createExpense(ctx: Ctx, input: unknown) {
  const data = expenseSchema.parse(input);
  const project = await requireOwned(
    await db.project.findUnique({ where: { id: data.projectId } }),
    "Project",
    ctx.orgId,
  );
  const expense = await db.expense.create({
    data: {
      orgId: ctx.orgId,
      projectId: data.projectId,
      clientId: project.clientId,
      categoryId: data.categoryId ?? null,
      date: new Date(data.date),
      amountMinor: toMinor(data.amount),
      currencyCode: project.currencyCode,
      billable: data.billable ?? true,
      description: data.description ?? null,
    },
  });
  await audit(db, ctx, "expense.created", "PROJECT", data.projectId, { amountMinor: data.amount });
  return expense;
}

export async function updateExpense(ctx: Ctx, id: string, input: unknown) {
  const data = expenseSchema.partial().omit({ projectId: true }).parse(input);
  const expense = await requireOwned(await db.expense.findUnique({ where: { id } }), "Expense", ctx.orgId);
  if (expense.invoiceLineId) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "This expense is already billed on an invoice");
  }
  return db.expense.update({
    where: { id },
    data: {
      date: data.date ? new Date(data.date) : undefined,
      amountMinor: data.amount != null ? toMinor(data.amount) : undefined,
      billable: data.billable,
      description: data.description,
      categoryId: data.categoryId,
    },
  });
}

export async function deleteExpense(ctx: Ctx, id: string) {
  const expense = await requireOwned(await db.expense.findUnique({ where: { id } }), "Expense", ctx.orgId);
  if (expense.invoiceLineId) {
    throw new AppError(ErrorCodes.ILLEGAL_STATE, "This expense is already billed on an invoice");
  }
  await db.expense.delete({ where: { id } });
  await audit(db, ctx, "expense.deleted", "PROJECT", expense.projectId);
}

export async function listExpenses(ctx: Ctx, query: URLSearchParams) {
  const p = paginationSchema.parse(Object.fromEntries(query));
  const projectId = query.get("projectId");
  const where = {
    orgId: ctx.orgId,
    ...(projectId ? { projectId } : {}),
    ...(query.get("unbilled") === "1" ? { billable: true, invoiceLineId: null } : {}),
  };
  const [rows, total, sum] = await Promise.all([
    db.expense.findMany({
      where,
      ...skipTake(p),
      orderBy: { date: "desc" },
      include: { project: { select: { id: true, name: true } }, category: true },
    }),
    db.expense.count({ where }),
    db.expense.aggregate({ where, _sum: { amountMinor: true } }),
  ]);
  return { rows, total, amountMinor: sum._sum.amountMinor ?? 0n, page: p.page, pageSize: p.pageSize };
}

export async function deleteProject(ctx: Ctx, id: string) {
  // Ownership check throws if the row is missing or belongs to another org.
  await requireOwned(await db.project.findUnique({ where: { id } }), "Project", ctx.orgId);
  const billed = await db.invoiceLineItem.count({
    where: { OR: [{ timeEntries: { some: { projectId: id } } }, { expenses: { some: { projectId: id } } }] },
  });
  if (billed > 0) {
    throw new AppError(
      ErrorCodes.CONFLICT,
      "Project work is already invoiced. Complete the project instead — deleting would break the financial trail.",
    );
  }
  await db.project.delete({ where: { id } });
  await audit(db, ctx, "project.deleted", "PROJECT", id);
}
