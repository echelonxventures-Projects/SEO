import { mkdirSync, writeFileSync } from "node:fs";

const routes = [];
const R = (path, methods) => routes.push({ path, methods });

// ---- CRM -------------------------------------------------------------
R("/api/v1/clients", {
  GET: { perm: "client.read", svc: ["crm.service", "listClients"], body: `const data = await listClients(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "client.write", svc: ["crm.service", "createClient"], body: `const data = await createClient(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/clients/[id]", {
  GET: { perm: "client.read", svc: ["crm.service", "getClient"], body: `const data = await getClient(ctxOf(viewer!, ip), params.id);` },
  PATCH: { perm: "client.write", svc: ["crm.service", "updateClient"], body: `const data = await updateClient(ctxOf(viewer!, ip), params.id, await readJson(req));` },
  DELETE: { perm: "client.delete", svc: ["crm.service", "deleteClient"], body: `await deleteClient(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/clients/[id]/contacts", {
  POST: { perm: "client.write", svc: ["crm.service", "createContact"], body: `const data = await createContact(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/contacts/[id]", {
  PATCH: { perm: "client.write", svc: ["crm.service", "updateContact"], body: `const data = await updateContact(ctxOf(viewer!, ip), params.id, await readJson(req));` },
  DELETE: { perm: "client.write", svc: ["crm.service", "deleteContact"], body: `await deleteContact(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/notes/[entityType]/[entityId]", {
  GET: { perm: "org.read", svc: ["crm.service", "listNotes", "noteEntityTypeSchema"], body: `const t = noteEntityTypeSchema.parse(params.entityType); const data = await listNotes(ctxOf(viewer!, ip), t, params.entityId);` },
  POST: { perm: "org.read", svc: ["crm.service", "createNote", "noteEntityTypeSchema"], body: `const t = noteEntityTypeSchema.parse(params.entityType); await createNote(ctxOf(viewer!, ip), t, params.entityId, await readJson(req));` },
});
R("/api/v1/leads", {
  GET: { perm: "lead.read", svc: ["crm.service", "listLeads"], body: `const data = await listLeads(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "lead.write", svc: ["crm.service", "createLead"], body: `const data = await createLead(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/leads/[id]", {
  DELETE: { perm: "lead.delete", svc: ["crm.service", "discardLead"], body: `const data = await discardLead(ctxOf(viewer!, ip), params.id, await readJson(req).catch(() => ({})));` },
});
R("/api/v1/leads/[id]/move", {
  POST: { perm: "lead.write", svc: ["crm.service", "moveLead"], body: `const data = await moveLead(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/leads/[id]/convert", {
  POST: { perm: "lead.convert", svc: ["crm.service", "convertLead"], body: `const data = await convertLead(ctxOf(viewer!, ip), params.id, await readJson(req).catch(() => ({})));` },
});

// ---- Delivery --------------------------------------------------------
R("/api/v1/projects", {
  GET: { perm: "project.read", svc: ["delivery.service", "listProjects"], body: `const data = await listProjects(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "project.write", svc: ["delivery.service", "createProject"], body: `const data = await createProject(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/projects/[id]", {
  GET: { perm: "project.read", svc: ["delivery.service", "getProject"], body: `const data = await getProject(ctxOf(viewer!, ip), params.id);` },
  PATCH: { perm: "project.write", svc: ["delivery.service", "updateProject"], body: `const data = await updateProject(ctxOf(viewer!, ip), params.id, await readJson(req));` },
  DELETE: { perm: "project.delete", svc: ["delivery.service", "deleteProject"], body: `await deleteProject(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/projects/[id]/members", {
  POST: { perm: "project.write", svc: ["delivery.service", "setProjectMembers"], body: `await setProjectMembers(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/tasks", {
  GET: { perm: "task.read", svc: ["delivery.service", "listTasks"], body: `const data = await listTasks(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "task.write", svc: ["delivery.service", "createTask"], body: `const data = await createTask(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/tasks/[id]", {
  PATCH: { perm: "task.write", svc: ["delivery.service", "updateTask"], body: `const data = await updateTask(ctxOf(viewer!, ip), params.id, await readJson(req));` },
  DELETE: { perm: "task.delete", svc: ["delivery.service", "deleteTask"], body: `await deleteTask(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/time", {
  GET: { perm: "time.read", svc: ["delivery.service", "listTimeEntries"], body: `const data = await listTimeEntries(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "time.write", svc: ["delivery.service", "createTimeEntry"], body: `const data = await createTimeEntry(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/time/[id]", {
  PATCH: { perm: "time.write", svc: ["delivery.service", "updateTimeEntry"], body: `const data = await updateTimeEntry(ctxOf(viewer!, ip), params.id, await readJson(req));` },
  DELETE: { perm: "time.delete", svc: ["delivery.service", "deleteTimeEntry"], body: `await deleteTimeEntry(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/expenses", {
  GET: { perm: "expense.read", svc: ["delivery.service", "listExpenses"], body: `const data = await listExpenses(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "expense.write", svc: ["delivery.service", "createExpense"], body: `const data = await createExpense(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/expenses/[id]", {
  PATCH: { perm: "expense.write", svc: ["delivery.service", "updateExpense"], body: `const data = await updateExpense(ctxOf(viewer!, ip), params.id, await readJson(req));` },
  DELETE: { perm: "expense.delete", svc: ["delivery.service", "deleteExpense"], body: `await deleteExpense(ctxOf(viewer!, ip), params.id);` },
});

// ---- Sales -----------------------------------------------------------
R("/api/v1/catalog/services", {
  GET: { perm: "catalog.read", svc: ["sales.service", "listServiceItems"], body: `const data = await listServiceItems(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "catalog.write", svc: ["sales.service", "createServiceItem"], body: `const data = await createServiceItem(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/catalog/services/[id]", {
  PATCH: { perm: "catalog.write", svc: ["sales.service", "updateServiceItem"], body: `const data = await updateServiceItem(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/quotes", {
  GET: { perm: "quote.read", svc: ["sales.service", "listQuotes"], body: `const data = await listQuotes(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "quote.write", svc: ["sales.service", "createQuote"], body: `const data = await createQuote(ctxOf(viewer!, ip), await readJson(req));` , idem: true},
});
R("/api/v1/quotes/[id]", {
  GET: { perm: "quote.read", svc: ["sales.service", "getQuote"], body: `const data = await getQuote(ctxOf(viewer!, ip), params.id);` },
  DELETE: { perm: "quote.delete", svc: ["sales.service", "deleteQuote"], body: `await deleteQuote(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/quotes/[id]/send", {
  POST: { perm: "quote.write", svc: ["sales.service", "sendQuote"], body: `const data = await sendQuote(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/quotes/[id]/decision", {
  POST: { perm: "quote.approve", svc: ["sales.service", "decideQuote"], body: `const data = await decideQuote(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/quotes/[id]/convert", {
  POST: { perm: "quote.convert", svc: ["sales.service", "convertQuoteToInvoice"], body: `const data = await convertQuoteToInvoice(ctxOf(viewer!, ip), params.id, await readJson(req).catch(() => ({})));` },
});
R("/api/v1/invoices", {
  GET: { perm: "invoice.read", svc: ["sales.service", "listInvoices"], body: `const data = await listInvoices(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "invoice.write", svc: ["sales.service", "createInvoice"], body: `const data = await createInvoice(ctxOf(viewer!, ip), await readJson(req));` , idem: true},
});
R("/api/v1/invoices/[id]", {
  GET: { perm: "invoice.read", svc: ["sales.service", "getInvoice"], body: `const data = await getInvoice(ctxOf(viewer!, ip), params.id);` },
  DELETE: { perm: "invoice.delete", svc: ["sales.service", "deleteInvoice"], body: `await deleteInvoice(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/invoices/[id]/issue", {
  POST: { perm: "invoice.issue", svc: ["sales.service", "issueInvoice"], body: `await issueInvoice(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/invoices/[id]/send", {
  POST: { perm: "invoice.issue", svc: ["sales.service", "sendInvoice"], body: `await sendInvoice(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/invoices/[id]/void", {
  POST: { perm: "invoice.void", svc: ["sales.service", "voidInvoice"], body: `await voidInvoice(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/invoices/[id]/unbilled", {
  POST: { perm: "invoice.write", svc: ["sales.service", "addUnbilledWorkToInvoice"], body: `await addUnbilledWorkToInvoice(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/invoices/[id]/checkout", {
  POST: { perm: "invoice.collect", svc: ["billing.service", "checkoutClientInvoice"], body: `const data = await checkoutClientInvoice(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/payments", {
  GET: { perm: "payment.read", svc: ["sales.service", "listPayments"], body: `const data = await listPayments(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "payment.write", svc: ["sales.service", "recordPayment"], body: `const data = await recordPayment(ctxOf(viewer!, ip), await readJson(req));` , idem: true},
});
R("/api/v1/payments/[id]", {
  DELETE: { perm: "payment.write", svc: ["sales.service", "deletePayment"], body: `await deletePayment(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/payments/[id]/refund", {
  POST: { perm: "payment.refund", svc: ["sales.service", "refundPayment"], body: `const data = await refundPayment(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});

// ---- SEO -------------------------------------------------------------
R("/api/v1/seo/keywords", {
  GET: { perm: "seo.read", svc: ["seo.service", "listKeywords"], body: `const data = await listKeywords(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "seo.write", svc: ["seo.service", "createKeyword"], body: `const data = await createKeyword(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/seo/keywords/[id]", {
  DELETE: { perm: "seo.write", svc: ["seo.service", "deleteKeyword"], body: `await deleteKeyword(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/seo/snapshots", {
  POST: { perm: "seo.write", svc: ["seo.service", "upsertSnapshot"], body: `const data = await upsertSnapshot(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/seo/snapshots/import", {
  POST: { perm: "seo.write", svc: ["seo.service", "importRankCsv"], body: `const csv = await req.text(); const data = await importRankCsv(ctxOf(viewer!, ip), csv);` },
});
R("/api/v1/seo/snapshots/refresh", {
  POST: { perm: "seo.write", svc: ["seo.service", "refreshRanksFromProvider"], body: `const data = await refreshRanksFromProvider(ctxOf(viewer!, ip));` },
});
R("/api/v1/seo/backlinks", {
  GET: { perm: "seo.read", svc: ["seo.service", "listBacklinks"], body: `const data = await listBacklinks(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "seo.write", svc: ["seo.service", "addBacklink"], body: `await addBacklink(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/seo/backlinks/[id]/check", {
  POST: { perm: "seo.write", svc: ["seo.service", "checkBacklink"], body: `const data = await checkBacklink(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/seo/audits", {
  GET: { perm: "seo.read", svc: ["seo.service", "listAudits"], body: `const data = await listAudits(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "seo.write", svc: ["seo.service", "runSiteAudit"], body: `const data = await runSiteAudit(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/seo/audits/[id]", {
  GET: { perm: "seo.read", svc: ["seo.service", "getAudit"], body: `const data = await getAudit(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/seo/summary", {
  GET: { perm: "seo.read", svc: ["seo.service", "seoSummary"], body: `const data = await seoSummary(ctxOf(viewer!, ip));` },
});

// ---- Campaigns -------------------------------------------------------
R("/api/v1/campaigns", {
  GET: { perm: "campaign.read", svc: ["campaign.service", "listCampaigns"], body: `const data = await listCampaigns(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "campaign.write", svc: ["campaign.service", "createCampaign"], body: `const data = await createCampaign(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/campaigns/[id]", {
  GET: { perm: "campaign.read", svc: ["campaign.service", "getCampaignDetail"], body: `const data = await getCampaignDetail(ctxOf(viewer!, ip), params.id);` },
  PATCH: { perm: "campaign.write", svc: ["campaign.service", "updateCampaign"], body: `const data = await updateCampaign(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/campaigns/[id]/metrics", {
  POST: { perm: "campaign.write", svc: ["campaign.service", "upsertMetric"], body: `const data = await upsertMetric(ctxOf(viewer!, ip), params.id, await readJson(req));` , idem: true},
});

// ---- Analytics & reports --------------------------------------------
R("/api/v1/analytics/overview", {
  GET: { perm: "client.read", svc: ["analytics.service", "dashboardOverview"], body: `const months = Number(req.nextUrl.searchParams.get("months") ?? 12); const data = await dashboardOverview(ctxOf(viewer!, ip), months);` },
});
R("/api/v1/reports", {
  GET: { perm: "report.read", svc: ["analytics.service", "listReports"], body: `const data = await listReports(ctxOf(viewer!, ip));` },
  POST: { perm: "report.write", svc: ["analytics.service", "createReport"], body: `const data = await createReport(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/reports/preview", {
  POST: { perm: "report.read", svc: ["analytics.service", "previewReport"], body: `const data = await previewReport(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/reports/[id]", {
  DELETE: { perm: "report.delete", svc: ["analytics.service", "deleteReport"], body: `await deleteReport(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/reports/[id]", {
  PATCH: { perm: "report.write", svc: ["analytics.service", "updateReport"], body: `const data = await updateReport(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/reports/[id]/run", {
  POST: { perm: "report.read", svc: ["analytics.service", "runReport"], body: `const data = await runReport(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/activity", {
  GET: { perm: "activity.read", svc: ["analytics.service", "listActivity"], body: `const data = await listActivity(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});

// ---- Team & settings -------------------------------------------------
R("/api/v1/team/members", {
  GET: { perm: "member.read", svc: ["org.service", "listMembers"], body: `const data = await listMembers(ctxOf(viewer!, ip));` },
});
R("/api/v1/team/invitations", {
  POST: { perm: "member.invite", svc: ["org.service", "inviteMember"], body: `const data = await inviteMember(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/team/invitations/[id]", {
  DELETE: { perm: "member.invite", svc: ["org.service", "revokeInvitation"], body: `await revokeInvitation(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/team/members/[id]/role", {
  POST: { perm: "member.update_role", svc: ["org.service", "updateMemberRole"], body: `await updateMemberRole(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/team/members/[id]", {
  DELETE: { perm: "member.remove", svc: ["org.service", "removeMember"], body: `await removeMember(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/settings/org", {
  PATCH: { perm: "org.update", svc: ["org.service", "updateOrg"], body: `const data = await updateOrg(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/settings/permissions", {
  GET: { perm: "member.read", svc: ["org.service", "listPermissionsCatalog"], body: `const data = await listPermissionsCatalog();` },
});
R("/api/v1/settings/categories", {
  POST: { perm: "settings.manage", svc: ["settings.service", "createCategory"], body: `const data = await createCategory(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/settings/categories/[id]", {
  PATCH: { perm: "settings.manage", svc: ["settings.service", "updateCategory"], body: `const data = await updateCategory(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/settings/stages", {
  POST: { perm: "settings.manage", svc: ["settings.service", "createStage"], body: `const data = await createStage(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/settings/stages/[id]", {
  PATCH: { perm: "settings.manage", svc: ["settings.service", "updateStage"], body: `const data = await updateStage(ctxOf(viewer!, ip), params.id, await readJson(req));` },
  DELETE: { perm: "settings.manage", svc: ["settings.service", "deleteStage"], body: `await deleteStage(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/settings/sequences/[id]", {
  PATCH: { perm: "settings.manage", svc: ["settings.service", "updateSequence"], body: `await updateSequence(ctxOf(viewer!, ip), params.id, await readJson(req));` },
});
R("/api/v1/settings/gateways", {
  GET: { perm: "settings.read", svc: ["billing.service", "listGatewayConfigs"], body: `const data = await listGatewayConfigs(ctxOf(viewer!, ip), viewer!.isPlatformAdmin);` },
  POST: { perm: "settings.manage", svc: ["billing.service", "upsertGatewayConfig"], body: `const data = await upsertGatewayConfig(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/settings/gateways/[id]/activate", {
  POST: { perm: "settings.manage", svc: ["billing.service", "activateGatewayConfig"], body: `await activateGatewayConfig(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/settings/gateways/[id]/deactivate", {
  POST: { perm: "settings.manage", svc: ["billing.service", "deactivateGatewayConfig"], body: `await deactivateGatewayConfig(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/settings/gateways/[id]", {
  DELETE: { perm: "settings.manage", svc: ["billing.service", "deleteGatewayConfig"], body: `await deleteGatewayConfig(ctxOf(viewer!, ip), params.id);` },
});
R("/api/v1/apikeys", {
  GET: { perm: "apikey.read", svc: ["org.service", "listApiKeys"], body: `const data = await listApiKeys(ctxOf(viewer!, ip));` },
  POST: { perm: "apikey.manage", svc: ["org.service", "createApiKey"], body: `const data = await createApiKey(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/apikeys/[id]/revoke", {
  POST: { perm: "apikey.manage", svc: ["org.service", "revokeApiKey"], body: `await revokeApiKey(ctxOf(viewer!, ip), params.id);` },
});

// ---- Billing (platform <-> org) ---------------------------------------
R("/api/v1/billing/subscription", {
  GET: { perm: "subscription.read", svc: ["billing.service", "getBillingState"], body: `const data = await getBillingState(ctxOf(viewer!, ip));` },
});
R("/api/v1/billing/subscribe", {
  POST: { perm: "subscription.manage", svc: ["billing.service", "subscribe"], body: `const data = await subscribe(ctxOf(viewer!, ip), await readJson(req));` , idem: true},
});
R("/api/v1/billing/cancel", {
  POST: { perm: "subscription.manage", svc: ["billing.service", "cancelSubscription"], body: `await cancelSubscription(ctxOf(viewer!, ip), await readJson(req).catch(() => ({})));` },
});
R("/api/v1/billing/resume", {
  POST: { perm: "subscription.manage", svc: ["billing.service", "resumeSubscription"], body: `await resumeSubscription(ctxOf(viewer!, ip));` },
});
R("/api/v1/billing/invoices/[id]/checkout", {
  POST: { perm: "subscription.manage", svc: ["billing.service", "checkoutTenantInvoice"], body: `const data = await checkoutTenantInvoice(ctxOf(viewer!, ip), params.id);` },
});

// ---- Public / machine endpoints ---------------------------------------
R("/api/v1/public/plans", {
  GET: { auth: "public", svc: ["billing.service", "listPublishedPlans"], body: `const data = await listPublishedPlans();` },
});
R("/api/v1/webhooks/[provider]", {
  POST: {
    auth: "public",
    rate: "api",
    svc: ["billing.service", "processWebhook"],
    body: `const raw = await req.text(); const result = await processWebhook(params.provider, raw, req.headers); const data = result;`,
  },
});
R("/api/v1/public/pay/[token]", {
  POST: { auth: "public", rate: "auth", svc: ["billing.service", "settleByCheckoutToken"], body: `const data = await settleByCheckoutToken(params.token, ip);` },
});
R("/api/v1/cron/renew", {
  POST: {
    auth: "public",
    rate: "auth",
    svc: ["billing.service", "renewDueSubscriptions"],
    body: `const { getEnv } = await import("@/server/env"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) { const { AppError, ErrorCodes } = await import("@/server/errors"); throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); } const data = await renewDueSubscriptions();`,
  },
});


// ---- Settings (full lifecycle in one place) -----------------------------
R("/api/v1/settings/tax-rates", {
  GET: { perm: "settings.read", svc: ["settings.service", "listTaxRates"], body: `const data = await listTaxRates(ctxOf(viewer!, ip));` },
  POST: { perm: "settings.manage", svc: ["settings.service", "createTaxRate"], body: `const data = await createTaxRate(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/settings/tax-rates/[id]", {
  PATCH: { perm: "settings.manage", svc: ["settings.service", "setTaxRateActive"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); const data = await setTaxRateActive(ctxOf(viewer!, ip), id, active);` },
});
R("/api/v1/settings/categories", {
  GET: { perm: "settings.read", svc: ["settings.service", "listCategories"], extra: [["categoryListSchema", "@/server/schemas"]], body: `const { kind } = categoryListSchema.parse(Object.fromEntries(req.nextUrl.searchParams)); const data = await listCategories(ctxOf(viewer!, ip), kind);` },
  POST: { perm: "settings.manage", svc: ["settings.service", "createCategory"], body: `const data = await createCategory(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/settings/stages", {
  GET: { perm: "settings.read", svc: ["settings.service", "listStages"], body: `const data = await listStages(ctxOf(viewer!, ip));` },
  POST: { perm: "settings.manage", svc: ["settings.service", "createStage"], body: `const data = await createStage(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/settings/sequences", {
  GET: { perm: "settings.read", svc: ["settings.service", "listSequences"], body: `const data = await listSequences(ctxOf(viewer!, ip));` },
});
R("/api/v1/settings/currencies", {
  GET: { perm: "settings.read", svc: ["settings.service", "listCurrencies"], body: `const data = await listCurrencies();` },
});
R("/api/v1/settings/geolocations", {
  GET: { perm: "seo.read", svc: ["settings.service", "listGeos"], body: `const data = await listGeos(ctxOf(viewer!, ip));` },
  POST: { perm: "settings.manage", svc: ["settings.service", "createGeo"], body: `const data = await createGeo(ctxOf(viewer!, ip), await readJson(req));` },
});


// ---- Social --------------------------------------------------------------
R("/api/v1/social/networks", {
  GET: { perm: "social.read", svc: ["social.service", "listNetworks"], body: `const data = await listNetworks(ctxOf(viewer!, ip));` },
});
R("/api/v1/social/connections", {
  GET: { perm: "social.read", svc: ["social.service", "listConnections"], body: `const data = await listConnections(ctxOf(viewer!, ip));` },
});
R("/api/v1/social/connect", {
  POST: { perm: "social.connect", svc: ["social.service", "beginConnect"], body: `const data = await beginConnect(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/social/demo-connect", {
  POST: { perm: "social.connect", svc: ["social.service", "connectDemo"], body: `const data = await connectDemo(ctxOf(viewer!, ip));` },
});
R("/api/v1/social/connections/[id]/disconnect", {
  POST: { perm: "social.connect", svc: ["social.service", "disconnect"], body: `await disconnect(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/social/apps", {
  GET: { perm: "settings.read", svc: ["social.service", "listSocialApps"], body: `const data = await listSocialApps(ctxOf(viewer!, ip));` },
  POST: { perm: "social.configure", svc: ["social.service", "upsertSocialApp"], body: `const data = await upsertSocialApp(ctxOf(viewer!, ip), await readJson(req));` },
});

// ---- Content calendar ------------------------------------------------------
R("/api/v1/content/posts", {
  GET: { perm: "content.read", svc: ["content.service", "listPosts"], body: `const data = await listPosts(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "content.write", svc: ["content.service", "createPost"], body: `const data = await createPost(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/content/posts/[id]", {
  GET: { perm: "content.read", svc: ["content.service", "getPost"], body: `const data = await getPost(ctxOf(viewer!, ip), id);` },
  PATCH: { perm: "content.write", svc: ["content.service", "updatePost"], body: `const data = await updatePost(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/content/posts/[id]/cancel", {
  POST: { perm: "content.write", svc: ["content.service", "cancelPost"], body: `await cancelPost(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/content/posts/[id]/publish-now", {
  POST: { perm: "content.publish", svc: ["content.service", "publishNow"], body: `await publishNow(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/content/targets/[id]/retry", {
  POST: { perm: "content.publish", svc: ["content.service", "retryTarget"], body: `await retryTarget(ctxOf(viewer!, ip), id);` },
});

// ---- Tracked links ---------------------------------------------------------
R("/api/v1/links", {
  GET: { perm: "link.read", svc: ["links.service", "listLinks"], body: `const data = await listLinks(ctxOf(viewer!, ip));` },
  POST: { perm: "link.write", svc: ["links.service", "createLink"], body: `const data = await createLink(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/links/[id]", {
  PATCH: { perm: "link.write", svc: ["links.service", "updateLink"], body: `const data = await updateLink(ctxOf(viewer!, ip), id, await readJson(req));` },
  DELETE: { perm: "link.write", svc: ["links.service", "deleteLink"], body: `await deleteLink(ctxOf(viewer!, ip), id);` },
});

// ---- Sites & pixels ----------------------------------------------------------
R("/api/v1/sites/properties", {
  GET: { perm: "site.read", svc: ["sites.service", "listProperties"], body: `const data = await listProperties(ctxOf(viewer!, ip));` },
  POST: { perm: "site.write", svc: ["sites.service", "createProperty"], body: `const data = await createProperty(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/sites/properties/[id]/verify", {
  POST: { perm: "site.write", svc: ["sites.service", "markVerified"], body: `const data = await markVerified(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/sites/properties/[id]/snippet", {
  GET: { perm: "site.read", svc: ["sites.service", "propertySnippet"], body: `const data = await propertySnippet(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/sites/properties/[id]/pixels", {
  POST: { perm: "site.write", svc: ["sites.service", "addPixel"], body: `const data = await addPixel(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/sites/templates", {
  GET: { perm: "site.read", svc: ["sites.service", "listTemplates"], body: `const data = await listTemplates(ctxOf(viewer!, ip));` },
  POST: { perm: "site.write", svc: ["sites.service", "upsertTemplate"], body: `const data = await upsertTemplate(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/sites/templates/[id]", {
  PATCH: { perm: "site.write", svc: ["sites.service", "upsertTemplate"], body: `const body = await readJson(req); const { placement, ...rest } = body as Record<string, unknown>; void placement; const data = await upsertTemplate(ctxOf(viewer!, ip), body, id);` },
});
R("/api/v1/sites/templates/[id]/toggle", {
  POST: { perm: "site.write", svc: ["sites.service", "toggleTemplate"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); await toggleTemplate(ctxOf(viewer!, ip), id, active);` },
});
R("/api/v1/sites/pixels/[id]", {
  PATCH: { perm: "site.write", svc: ["sites.service", "togglePixel"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); const data = await togglePixel(ctxOf(viewer!, ip), id, active);` },
});

// ---- Email marketing ----------------------------------------------------------
R("/api/v1/email/lists", {
  GET: { perm: "email.read", svc: ["email.service", "listLists"], body: `const data = await listLists(ctxOf(viewer!, ip));` },
  POST: { perm: "email.write", svc: ["email.service", "createList"], body: `const data = await createList(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/email/lists/[id]/subscribers", {
  GET: { perm: "email.read", svc: ["email.service", "listSubscribers"], body: `const data = await listSubscribers(ctxOf(viewer!, ip), id);` },
  POST: { perm: "email.write", svc: ["email.service", "addSubscriber"], body: `const data = await addSubscriber(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/email/campaigns", {
  GET: { perm: "email.read", svc: ["email.service", "listEmailCampaigns"], body: `const data = await listEmailCampaigns(ctxOf(viewer!, ip));` },
  POST: { perm: "email.write", svc: ["email.service", "createEmailCampaign"], body: `const data = await createEmailCampaign(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/email/campaigns/[id]", {
  GET: { perm: "email.read", svc: ["email.service", "getEmailCampaign"], body: `const data = await getEmailCampaign(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/email/campaigns/[id]/queue", {
  POST: { perm: "email.send", svc: ["email.service", "queueSend"], body: `const body = await readJson(req); await queueSend(ctxOf(viewer!, ip), id, (body as { scheduledAt?: string } | null)?.scheduledAt ?? null);` },
});
R("/api/v1/email/campaigns/[id]/cancel", {
  POST: { perm: "email.send", svc: ["email.service", "cancelEmailCampaign"], body: `await cancelEmailCampaign(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/email/campaigns/[id]/test", {
  POST: { perm: "email.send", svc: ["email.service", "testEmailCampaign"], body: `await testEmailCampaign(ctxOf(viewer!, ip), id);` },
});

// ---- AI Studio ---------------------------------------------------------------
R("/api/v1/studio/generate", {
  POST: { perm: "content.write", svc: ["studio.service", "createGenerationJob"], body: `const data = await createGenerationJob(ctxOf(viewer!, ip), await readJson(req));` , idem: true},
});
R("/api/v1/studio/jobs", {
  GET: { perm: "content.read", svc: ["studio.service", "listJobs"], body: `const data = await listJobs(ctxOf(viewer!, ip));` },
});
R("/api/v1/studio/jobs/[id]", {
  GET: { perm: "content.read", svc: ["studio.service", "getJob"], body: `const data = await getJob(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/studio/voices", {
  GET: { perm: "content.read", svc: ["studio.service", "listVoices"], body: `const data = await listVoices(ctxOf(viewer!, ip));` },
  POST: { perm: "content.write", svc: ["studio.service", "upsertVoice"], body: `const data = await upsertVoice(ctxOf(viewer!, ip), null, await readJson(req));` },
});
R("/api/v1/studio/voices/[id]", {
  PATCH: { perm: "content.write", svc: ["studio.service", "upsertVoice"], body: `const data = await upsertVoice(ctxOf(viewer!, ip), id, await readJson(req));` },
  DELETE: { perm: "content.write", svc: ["studio.service", "deleteVoice"], body: `await deleteVoice(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/studio/templates", {
  GET: { perm: "settings.read", svc: ["studio.service", "listTemplates"], body: `const data = await listTemplates(ctxOf(viewer!, ip));` },
});
R("/api/v1/studio/configs", {
  GET: { perm: "settings.read", svc: ["studio.service", "listAiConfigs"], body: `const data = await listAiConfigs(ctxOf(viewer!, ip));` },
  POST: { perm: "settings.manage", svc: ["studio.service", "upsertAiConfig"], body: `const data = await upsertAiConfig(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/studio/configs/[id]/activate", {
  POST: { perm: "settings.manage", svc: ["studio.service", "activateAiConfig"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); await activateAiConfig(ctxOf(viewer!, ip), id, active);` },
});

// ---- Blogs -------------------------------------------------------------------
R("/api/v1/blogs", {
  GET: { perm: "content.read", svc: ["studio.service", "listBlogs"], body: `const data = await listBlogs(ctxOf(viewer!, ip));` },
  POST: { perm: "content.write", svc: ["studio.service", "saveBlogFromJob"], body: `const data = await saveBlogFromJob(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/blogs/[id]", {
  GET: { perm: "content.read", svc: ["studio.service", "getBlog"], body: `const data = await getBlog(ctxOf(viewer!, ip), id);` },
  PATCH: { perm: "content.write", svc: ["studio.service", "updateBlog"], body: `const data = await updateBlog(ctxOf(viewer!, ip), id, await readJson(req));` },
  DELETE: { perm: "content.write", svc: ["studio.service", "deleteBlog"], body: `await deleteBlog(ctxOf(viewer!, ip), id);` },
});

// ---- Ad creatives ---------------------------------------------------------------
R("/api/v1/creatives", {
  GET: { perm: "campaign.read", svc: ["studio.service", "listAdCreatives"], body: `const cid = req.nextUrl.searchParams.get("campaignId") ?? undefined; const data = await listAdCreatives(ctxOf(viewer!, ip), cid);` },
  POST: { perm: "campaign.write", svc: ["studio.service", "createAdCreative"], body: `const data = await createAdCreative(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/creatives/[id]/status", {
  POST: {
    perm: "campaign.write",
    svc: ["studio.service", "updateAdCreativeStatus"],
    extra: [["z", "zod"]],
    body: `const { status } = z.object({ status: z.enum(["DRAFT", "APPROVED", "LIVE", "PAUSED", "ARCHIVED"]) }).parse(await readJson(req)); const data = await updateAdCreativeStatus(ctxOf(viewer!, ip), id, status);`,
  },
});

R("/api/v1/studio/routing", {
  GET: { perm: "settings.read", svc: ["studio.service", "studioRouting"], body: `const cap = (req.nextUrl.searchParams.get("capability") ?? "text") as "text" | "image" | "audio"; const data = await studioRouting(ctxOf(viewer!, ip), cap);` },
});
R("/api/v1/settings/plan-features", {
  GET: {
    perm: "settings.read",
    svc: ["settings.service", "listPlanFeatureCatalog"],
    body: `const data = await listPlanFeatureCatalog();`,
  },
});

// ---- Tags -----------------------------------------------------------------------
R("/api/v1/tags", {
  GET: { perm: "org.read", svc: ["tags.service", "listTags"], body: `const data = await listTags(ctxOf(viewer!, ip));` },
  POST: { perm: "client.write", svc: ["tags.service", "upsertTag"], body: `const data = await upsertTag(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/tags/assign", {
  POST: {
    perm: "client.write",
    svc: ["tags.service", "attachTags", "entityTypeSchema"],
    body: `const { entityType, entityId, tagIds } = z.object({ entityType: entityTypeSchema, entityId: z.string().min(1), tagIds: z.array(z.string()).max(25) }).parse(await readJson(req)); await attachTags(ctxOf(viewer!, ip), entityType, entityId, tagIds);`,
    extra: [["z", "zod"]],
  },
});
R("/api/v1/tags/entities", {
  GET: {
    perm: "org.read",
    svc: ["tags.service", "tagsFor", "entityTypeSchema"],
    body: `const t = entityTypeSchema.parse(req.nextUrl.searchParams.get("entityType")); const id = req.nextUrl.searchParams.get("entityId") ?? ""; const data = await tagsFor(ctxOf(viewer!, ip), t, id);`,
  },
});

// ---- Channels, audiences, calendar -------------------------------------------------
R("/api/v1/channels", {
  GET: { perm: "campaign.read", svc: ["channels.service", "listChannels"], body: `const data = await listChannels(ctxOf(viewer!, ip));` },
  POST: { perm: "campaign.write", svc: ["channels.service", "createChannel"], body: `const data = await createChannel(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/channels/[id]/toggle", {
  POST: { perm: "campaign.write", svc: ["channels.service", "toggleChannel"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); await toggleChannel(ctxOf(viewer!, ip), id, active);` },
});
R("/api/v1/audiences", {
  GET: { perm: "campaign.read", svc: ["audiences.service", "listAudiences"], body: `const data = await listAudiences(ctxOf(viewer!, ip));` },
  POST: { perm: "campaign.write", svc: ["audiences.service", "createAudience"], body: `const data = await createAudience(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/audiences/[id]", {
  GET: { perm: "campaign.read", svc: ["audiences.service", "getAudience"], body: `const data = await getAudience(ctxOf(viewer!, ip), id);` },
  DELETE: { perm: "campaign.write", svc: ["audiences.service", "archiveAudience"], body: `await archiveAudience(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/audiences/[id]/members", {
  GET: { perm: "campaign.read", svc: ["audiences.service", "listMembers"], body: `const data = await listMembers(ctxOf(viewer!, ip), id, req.nextUrl.searchParams);` },
  POST: { perm: "campaign.write", svc: ["audiences.service", "addMember"], body: `const data = await addMember(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/audiences/[id]/members/[memberId]", {
  DELETE: { perm: "campaign.write", svc: ["audiences.service", "removeMember"], body: `await removeMember(ctxOf(viewer!, ip), id, memberId);` },
});
R("/api/v1/audiences/[id]/import", {
  POST: { perm: "campaign.write", svc: ["audiences.service", "importCsv"], body: `const csv = await req.text(); const data = await importCsv(ctxOf(viewer!, ip), id, csv);` },
});
R("/api/v1/audiences/[id]/sync", {
  POST: { perm: "campaign.write", svc: ["audiences.service", "syncFromList"], body: `const data = await syncFromList(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/calendar", {
  GET: { perm: "campaign.read", svc: ["calendar.service", "calendarView"], body: `const data = await calendarView(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/flights", {
  GET: { perm: "campaign.read", svc: ["calendar.service", "listFlights"], body: `const cid = req.nextUrl.searchParams.get("campaignId") ?? undefined; const data = await listFlights(ctxOf(viewer!, ip), cid);` },
  POST: { perm: "campaign.write", svc: ["calendar.service", "createFlight"], body: `const data = await createFlight(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/flights/[id]", {
  PATCH: { perm: "campaign.write", svc: ["calendar.service", "updateFlight"], body: `const data = await updateFlight(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/flights/[id]/approve", {
  POST: { perm: "campaign.write", svc: ["calendar.service", "approveFlight"], body: `const data = await approveFlight(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/flights/[id]/cancel", {
  POST: { perm: "campaign.write", svc: ["calendar.service", "cancelFlight"], body: `await cancelFlight(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/flights/[id]/slots", {
  POST: { perm: "campaign.write", svc: ["calendar.service", "generateSlots"], body: `const data = await generateSlots(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/campaigns/wizard", {
  POST: { perm: "campaign.write", svc: ["calendar.service", "runWizard"], body: `const data = await runWizard(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/social/templates", {
  POST: { perm: "social.configure", svc: ["social.service", "createConnectorTemplate"], body: `const data = await createConnectorTemplate(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/social/templates/[id]/toggle", {
  POST: { perm: "social.configure", svc: ["social.service", "toggleConnectorTemplate"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); await toggleConnectorTemplate(ctxOf(viewer!, ip), id, active);` },
});
R("/api/v1/cron/events", {
  POST: {
    auth: "public", rate: "auth",
    svc: ["events", "runEventDispatcher"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await runEventDispatcher();`,
  },
});
R("/api/v1/cron/offers", {
  POST: {
    auth: "public", rate: "auth",
    svc: ["offers.service", "sweepOffers"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await sweepOffers();`,
  },
});
R("/api/v1/cron/flights", {
  POST: {
    auth: "public",
    rate: "auth",
    svc: ["calendar.service", "sweepFlights"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await sweepFlights();`,
  },
});

// ---- UCOS backbone: registry, events, offers, orchestrator -----------------------
R("/api/v1/registry", {
  GET: { auth: "public", svc: ["events-api", "registryDoc"], body: `const data = await registryDoc();` },
});
R("/api/v1/events", {
  GET: { perm: "activity.read", svc: ["events-api", "listEventsApi"], body: `const data = await listEventsApi(ctxOf(viewer!, ip), req.nextUrl.searchParams.get("type") ?? undefined);` },
});
R("/api/v1/events/subscriptions", {
  GET: { perm: "settings.read", svc: ["events-api", "listSubsApi"], body: `const data = await listSubsApi(ctxOf(viewer!, ip));` },
  POST: { perm: "settings.manage", svc: ["events-api", "createSubApi"], body: `const data = await createSubApi(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/events/subscriptions/[id]", {
  DELETE: { perm: "settings.manage", svc: ["events-api", "toggleSubApi"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); await toggleSubApi(ctxOf(viewer!, ip), id, !active);` },
});
R("/api/v1/events/subscriptions/[id]/deliveries", {
  GET: { perm: "settings.read", svc: ["events-api", "deliveriesApi"], body: `const data = await deliveriesApi(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/offers", {
  GET: { perm: "campaign.read", svc: ["offers.service", "listOffers"], body: `const data = await listOffers(ctxOf(viewer!, ip));` },
  POST: { perm: "campaign.write", svc: ["offers.service", "createOffer"], body: `const data = await createOffer(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/offers/[id]", {
  GET: { perm: "campaign.read", svc: ["offers.service", "getOffer"], body: `const data = await getOffer(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/offers/[id]/status", {
  POST: {
    perm: "campaign.write",
    svc: ["offers.service", "transitionOffer"],
    extra: [["z", "zod"]],
    body: `const { status } = z.object({ status: z.enum(["DRAFT","PENDING_APPROVAL","APPROVED","PUBLISHED","ACTIVE","EXPIRED","ARCHIVED"]) }).parse(await readJson(req)); const data = await transitionOffer(ctxOf(viewer!, ip), id, status);`,
  },
});
R("/api/v1/campaigns/[id]/orchestration", {
  GET: { perm: "campaign.read", svc: ["orchestrator.service", "getOrchestration"], body: `const data = await getOrchestration(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/campaigns/[id]/plan", {
  POST: { perm: "campaign.write", svc: ["orchestrator.service", "planCampaign"], body: `await planCampaign(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/campaigns/[id]/transition", {
  POST: {
    perm: "campaign.write",
    svc: ["orchestrator.service", "transitionCampaign"],
    extra: [["z", "zod"]],
    body: `const { to } = z.object({ to: z.enum(["PLANNED","PENDING_APPROVAL","APPROVED","LIVE","CLOSED","LEARNED"]) }).parse(await readJson(req)); await transitionCampaign(ctxOf(viewer!, ip), id, to);`,
  },
});
R("/api/v1/campaigns/[id]/simulate", {
  POST: { perm: "campaign.read", svc: ["orchestrator.service", "simulateCampaign"], body: `const data = await simulateCampaign(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/campaigns/[id]/learn", {
  POST: { perm: "campaign.write", svc: ["orchestrator.service", "learnCampaign"], body: `const data = await learnCampaign(ctxOf(viewer!, ip), id);` },
});

R("/api/v1/content/kinds", {
  GET: { perm: "content.read", svc: ["content.service", "listKinds"], body: `const data = await listKinds(ctxOf(viewer!, ip));` },
  POST: { perm: "content.write", svc: ["content.service", "createKind"], body: `const data = await createKind(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/content/posts/[id]/stage", {
  POST: { perm: "content.write", svc: ["content.service", "moveStage"], extra: [["z", "zod"]], body: `const { to } = z.object({ to: z.enum(["IDEATION","RESEARCH","PLANNING","CREATION","REVIEW","APPROVED","PUBLISHING","PUBLISHED","OPTIMIZING","ARCHIVED"]) }).parse(await readJson(req)); const data = await moveStage(ctxOf(viewer!, ip), id, to);` },
});
R("/api/v1/audiences/[id]/segments", {
  GET: { perm: "campaign.read", svc: ["audiences.service", "listSegments"], body: `const data = await listSegments(ctxOf(viewer!, ip), id);` },
  POST: { perm: "campaign.write", svc: ["audiences.service", "createSegment"], body: `const data = await createSegment(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/segments/[id]/members", {
  GET: { perm: "campaign.read", svc: ["audiences.service", "evaluateSegment"], body: `const data = await evaluateSegment(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/segments/[id]", {
  DELETE: { perm: "campaign.write", svc: ["audiences.service", "deleteSegment"], body: `await deleteSegment(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/members/[memberId]/identities", {
  GET: { perm: "campaign.read", svc: ["audiences.service", "listMemberIdentities"], body: `const data = await listMemberIdentities(ctxOf(viewer!, ip), memberId);` },
  POST: { perm: "campaign.write", svc: ["audiences.service", "addIdentity"], body: `const data = await addIdentity(ctxOf(viewer!, ip), memberId, await readJson(req));` },
});
R("/api/v1/identities/[id]", {
  DELETE: { perm: "campaign.write", svc: ["audiences.service", "removeIdentity"], body: `await removeIdentity(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/triggers", {
  GET: { perm: "campaign.read", svc: ["triggers.service", "listTriggers"], body: `const data = await listTriggers(ctxOf(viewer!, ip));` },
  POST: { perm: "campaign.write", svc: ["triggers.service", "createTrigger"], body: `const data = await createTrigger(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/triggers/[id]/toggle", {
  POST: { perm: "campaign.write", svc: ["triggers.service", "toggleTrigger"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); await toggleTrigger(ctxOf(viewer!, ip), id, active);` },
});
R("/api/v1/custom-fields", {
  GET: { perm: "settings.read", svc: ["customfields.service", "listFieldDefs"], body: `const data = await listFieldDefs(ctxOf(viewer!, ip), req.nextUrl.searchParams.get("entity") ?? "CLIENT");` },
  POST: { perm: "settings.manage", svc: ["customfields.service", "upsertFieldDef"], body: `const data = await upsertFieldDef(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/custom-fields/[id]", {
  DELETE: { perm: "settings.manage", svc: ["customfields.service", "deactivateFieldDef"], body: `await deactivateFieldDef(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/clients/[id]/onboarding", {
  GET: { perm: "client.read", svc: ["crm.service", "listOnboarding"], body: `const data = await listOnboarding(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/clients/[id]/onboarding/[stepId]", {
  POST: { perm: "client.write", svc: ["crm.service", "toggleOnboardingStep"], body: `const data = await toggleOnboardingStep(ctxOf(viewer!, ip), id, stepId);` },
});

// ---- Machine endpoints -----------------------------------------------------------
R("/api/v1/cron/publisher", {
  POST: {
    auth: "public",
    rate: "auth",
    svc: ["content.service", "runPublisher"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await runPublisher();`,
  },
});
R("/api/v1/cron/email-dispatch", {
  POST: {
    auth: "public",
    rate: "auth",
    svc: ["email.service", "runEmailDispatcher"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await runEmailDispatcher();`,
  },
});

// ---- UTP: Temporal Platform --------------------------------------------------
R("/api/v1/temporal/calendars", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "listCalendars"], body: `const data = await listCalendars(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.write", svc: ["temporal.service", "createCalendar"], body: `const data = await createCalendar(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/calendars/[id]", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "getCalendar"], body: `const data = await getCalendar(ctxOf(viewer!, ip), id);` },
  PATCH: { perm: "temporal.write", svc: ["temporal.service", "updateCalendar"], body: `const data = await updateCalendar(ctxOf(viewer!, ip), id, await readJson(req));` },
  DELETE: { perm: "temporal.write", svc: ["temporal.service", "archiveCalendar"], body: `const data = await archiveCalendar(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/calendars/[id]/share", {
  POST: { perm: "temporal.write", svc: ["temporal.service", "shareCalendar"], body: `const data = await shareCalendar(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/temporal/calendars/[id]/shares/[shareId]", {
  DELETE: { perm: "temporal.write", svc: ["temporal.service", "unshareCalendar"], body: `await unshareCalendar(ctxOf(viewer!, ip), id, shareId);` },
});
R("/api/v1/temporal/calendars/[id]/feed-link", {
  GET: { perm: "temporal.write", svc: ["temporal-feed", "createFeedLink"], body: `const data = await createFeedLink(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/calendars/[id]/share-tokens", {
  GET: { perm: "temporal.read", svc: ["temporal-feed", "listShareTokens"], body: `const data = await listShareTokens(ctxOf(viewer!, ip), id);` },
  DELETE: { perm: "temporal.write", svc: ["temporal-feed", "revokeShareTokens"], body: `const data = await revokeShareTokens(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/agenda", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "agenda"], body: `const data = await agenda(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/patterns", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "listPatterns"], body: `const data = await listPatterns(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.write", svc: ["temporal.service", "createPattern"], body: `const data = await createPattern(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/patterns/[id]", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "getPattern"], body: `const data = await getPattern(ctxOf(viewer!, ip), id);` },
  PATCH: { perm: "temporal.write", svc: ["temporal.service", "updatePattern"], body: `const data = await updatePattern(ctxOf(viewer!, ip), id, await readJson(req));` },
  DELETE: { perm: "temporal.write", svc: ["temporal.service", "deletePattern"], body: `const data = await deletePattern(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/patterns/[id]/preview", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "previewPattern"], body: `const q = req.nextUrl.searchParams; const data = await previewPattern(ctxOf(viewer!, ip), id, q.get("from") ?? undefined, q.get("days") ? Number(q.get("days")) : undefined, q.get("max") ? Number(q.get("max")) : undefined);` },
});
R("/api/v1/temporal/patterns/[id]/deprecate", {
  POST: { perm: "temporal.write", svc: ["temporal.service", "deprecatePattern"], body: `const data = await deprecatePattern(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/dsl/compile", {
  POST: { perm: "temporal.read", svc: ["temporal.service", "dslStudio"], body: `const data = await dslStudio(await readJson(req));` },
});
R("/api/v1/temporal/events", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "listEvents"], body: `const data = await listEvents(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "temporal.write", svc: ["temporal.service", "createEvent"], body: `const data = await createEvent(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/events/[id]", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "getEvent"], body: `const data = await getEvent(ctxOf(viewer!, ip), id);` },
  PATCH: { perm: "temporal.write", svc: ["temporal.service", "updateEvent"], body: `const data = await updateEvent(ctxOf(viewer!, ip), id, await readJson(req));` },
  DELETE: { perm: "temporal.write", svc: ["temporal.service", "cancelEvent"], body: `const data = await cancelEvent(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/events/[id]/extend", {
  POST: { perm: "temporal.write", svc: ["temporal.service", "extendEvent"], body: `const body = await readJson(req).catch(() => ({})); const data = await extendEvent(ctxOf(viewer!, ip), id, (body as { days?: number }).days);` },
});
R("/api/v1/temporal/events/[id]/resolve", {
  POST: { perm: "temporal.read", svc: ["temporal-intelligence.service", "resolveEventDeps"], body: `const data = await resolveEventDeps(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/occurrences/[id]/cancel", {
  POST: { perm: "temporal.write", svc: ["temporal.service", "cancelOccurrence"], body: `const body = await readJson(req).catch(() => ({})); const data = await cancelOccurrence(ctxOf(viewer!, ip), id, (body as { reason?: string }).reason);` },
});
R("/api/v1/temporal/occurrences/[id]/move", {
  POST: { perm: "temporal.write", svc: ["temporal.service", "moveOccurrence"], body: `const body = await readJson(req) as { startsAt: string; endsAt?: string }; const data = await moveOccurrence(ctxOf(viewer!, ip), id, body.startsAt, body.endsAt);` },
});
R("/api/v1/temporal/dependencies", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "listDependencies"], body: `const data = await listDependencies(ctxOf(viewer!, ip), req.nextUrl.searchParams.get("eventId") ?? undefined);` },
  POST: { perm: "temporal.write", svc: ["temporal.service", "createDependency"], body: `const data = await createDependency(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/dependencies/[id]", {
  DELETE: { perm: "temporal.write", svc: ["temporal.service", "deleteDependency"], body: `await deleteDependency(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/config", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "getTemporalConfig"], body: `const data = await getTemporalConfig(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.write", svc: ["temporal.service", "updateTemporalConfig"], body: `const data = await updateTemporalConfig(ctxOf(viewer!, ip), await readJson(req));` },
});

// ---- UTP: booking -------------------------------------------------------------
R("/api/v1/temporal/slots/generate", {
  POST: { perm: "appointment.manage", svc: ["temporal-booking.service", "generateSlots"], body: `const data = await generateSlots(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/slots/open", {
  GET: { perm: "appointment.read", svc: ["temporal-booking.service", "openSlots"], body: `const data = await openSlots(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/appointments", {
  GET: { perm: "appointment.read", svc: ["temporal-booking.service", "listAppointments"], body: `const data = await listAppointments(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/appointments/book", {
  POST: { perm: "appointment.book", svc: ["temporal-booking.service", "book"], body: `const data = await book(ctxOf(viewer!, ip), await readJson(req));`, idem: true },
});
R("/api/v1/temporal/appointments/waitlist", {
  POST: { perm: "appointment.book", svc: ["temporal-booking.service", "joinWaitlist"], body: `const data = await joinWaitlist(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/appointments/[id]", {
  GET: { perm: "appointment.read", svc: ["temporal-booking.service", "getAppointment"], body: `const data = await getAppointment(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/appointments/[id]/[action]", {
  POST: {
    perm: "appointment.book",
    svc: ["temporal-booking.service", "transitionAppointment"],
    extra: [["z", "zod"]],
    body: `const { action: verb, reason } = z.object({ action: z.enum(["confirm", "cancel", "checkIn", "complete", "noShow"]), reason: z.string().max(200).optional() }).parse({ action, ...((await readJson(req)) as object) }); const data = await transitionAppointment(ctxOf(viewer!, ip), id, verb, reason);`,
  },
});
R("/api/v1/temporal/calendars/[id]/booking-link", {
  GET: { perm: "appointment.manage", svc: ["temporal-booking.service", "createBookingLink"], body: `const data = await createBookingLink(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/public/booking/[token]", {
  GET: { auth: "public", rate: "auth", svc: ["temporal-booking.service", "publicAgenda"], body: `const data = await publicAgenda(params.token);` },
  POST: { auth: "public", rate: "auth", svc: ["temporal-booking.service", "publicBook"], body: `const data = await publicBook(params.token, await readJson(req), ip, req.headers.get("idempotency-key"));` },
});
R("/api/v1/temporal/appointments/[id]/reschedule", {
  POST: { perm: "appointment.book", svc: ["temporal-booking.service", "reschedule"], body: `const body = await readJson(req) as { slotId: string }; const data = await reschedule(ctxOf(viewer!, ip), id, body.slotId);` },
});

// ---- UTP: resources & availability --------------------------------------------
R("/api/v1/temporal/resources", {
  GET: { perm: "resource.read", svc: ["temporal-resources.service", "listResources"], body: `const data = await listResources(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "resource.write", svc: ["temporal-resources.service", "createResource"], body: `const data = await createResource(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/resources/[id]", {
  PATCH: { perm: "resource.write", svc: ["temporal-resources.service", "updateResource"], body: `const data = await updateResource(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/temporal/resources/[id]/book", {
  POST: { perm: "resource.write", svc: ["temporal-resources.service", "bookResource"], body: `const body = await readJson(req) as Record<string, unknown>; const data = await bookResource(ctxOf(viewer!, ip), { ...body, resourceId: id });`, idem: true },
});
R("/api/v1/temporal/resources/[id]/conflicts", {
  GET: { perm: "resource.read", svc: ["temporal-resources.service", "resourceConflicts"], body: `const q = req.nextUrl.searchParams; const data = await resourceConflicts(ctxOf(viewer!, ip), id, q.get("from") ?? undefined, q.get("to") ?? undefined);` },
});
R("/api/v1/temporal/bookings/[id]/release", {
  POST: { perm: "resource.write", svc: ["temporal-resources.service", "releaseBooking"], body: `await releaseBooking(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/availability", {
  GET: { perm: "resource.read", svc: ["temporal-resources.service", "listAvailability"], body: `const data = await listAvailability(ctxOf(viewer!, ip));` },
  POST: { perm: "resource.write", svc: ["temporal-resources.service", "upsertAvailability"], body: `const data = await upsertAvailability(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/availability/[id]", {
  DELETE: { perm: "resource.write", svc: ["temporal-resources.service", "deleteAvailability"], body: `await deleteAvailability(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/availability/[id]/blackouts", {
  POST: { perm: "resource.write", svc: ["temporal-resources.service", "addBlackout"], body: `const data = await addBlackout(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/temporal/availability/preview", {
  GET: { perm: "resource.read", svc: ["temporal-resources.service", "availabilityPreview"], body: `const q = req.nextUrl.searchParams; const data = await availabilityPreview(ctxOf(viewer!, ip), q.get("subjectType") ?? "USER", q.get("subjectId") ?? viewer!.userId, q);` },
});

// ---- UTP: workforce ------------------------------------------------------------
R("/api/v1/temporal/workforce/shifts", {
  GET: { perm: "workforce.read", svc: ["temporal-resources.service", "listShifts"], body: `const data = await listShifts(ctxOf(viewer!, ip));` },
  POST: { perm: "workforce.write", svc: ["temporal-resources.service", "createShift"], body: `const data = await createShift(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/workforce/assign", {
  POST: { perm: "workforce.write", svc: ["temporal-resources.service", "assignShift"], body: `const data = await assignShift(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/workforce/assignments", {
  GET: { perm: "workforce.read", svc: ["temporal-resources.service", "listAssignments"], body: `const data = await listAssignments(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/workforce/assignments/[id]", {
  DELETE: { perm: "workforce.write", svc: ["temporal-resources.service", "deleteAssignment"], body: `await deleteAssignment(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/workforce/rotate", {
  POST: { perm: "workforce.write", svc: ["temporal-resources.service", "generateRotation"], body: `const data = await generateRotation(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/workforce/coverage", {
  GET: { perm: "workforce.read", svc: ["temporal-resources.service", "coverageGaps"], body: `const data = await coverageGaps(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "workforce.write", svc: ["temporal-resources.service", "upsertCoverageRequirement"], body: `const data = await upsertCoverageRequirement(ctxOf(viewer!, ip), await readJson(req));` },
});

// ---- UTP: triggers -------------------------------------------------------------
R("/api/v1/temporal/triggers", {
  GET: { perm: "temporal.read", svc: ["temporal-triggers.service", "listTriggers"], body: `const data = await listTriggers(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.write", svc: ["temporal-triggers.service", "createTrigger"], body: `const data = await createTrigger(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/triggers/[id]/toggle", {
  POST: { perm: "temporal.write", svc: ["temporal-triggers.service", "toggleTrigger"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); const data = await toggleTrigger(ctxOf(viewer!, ip), id, active);` },
});
R("/api/v1/temporal/triggers/[id]/arm-on-event", {
  POST: { perm: "temporal.write", svc: ["temporal-triggers.service", "armEventTrigger"], body: `const body = await readJson(req) as { eventId: string }; const data = await armEventTrigger(ctxOf(viewer!, ip), id, body.eventId);` },
});
R("/api/v1/temporal/triggers/[id]", {
  DELETE: { perm: "temporal.write", svc: ["temporal-triggers.service", "deleteTrigger"], body: `const data = await deleteTrigger(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/triggers/[id]/fires", {
  GET: { perm: "temporal.read", svc: ["temporal-triggers.service", "listTriggerFires"], body: `const data = await listTriggerFires(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/executions", {
  GET: { perm: "temporal.read", svc: ["temporal-triggers.service", "listExecutions"], body: `const data = await listExecutions(ctxOf(viewer!, ip));` },
});

// ---- UTP: governance -------------------------------------------------------------
R("/api/v1/temporal/governance/versions/[entityType]/[entityId]", {
  GET: { perm: "temporal.read", svc: ["temporal-library.service", "listVersions"], body: `const data = await listVersions(ctxOf(viewer!, ip), entityType, entityId);` },
});
R("/api/v1/temporal/governance/replay/[entityType]/[entityId]", {
  GET: { perm: "temporal.read", svc: ["temporal-library.service", "readReplay"], body: `const data = await readReplay(ctxOf(viewer!, ip), entityType, entityId, req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/governance/rollback", {
  POST: { perm: "temporal.manage", svc: ["temporal-library.service", "rollbackToVersion"], body: `const body = await readJson(req) as { entityType: string; entityId: string; version: number }; const data = await rollbackToVersion(ctxOf(viewer!, ip), body.entityType, body.entityId, body.version);` },
});
R("/api/v1/temporal/governance/events", {
  GET: { perm: "temporal.read", svc: ["temporal-library.service", "eventLog"], body: `const data = await eventLog(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});

// ---- UTP: library, rules, holidays, fiscal, time systems --------------------------
R("/api/v1/temporal/rules", {
  GET: { perm: "temporal.read", svc: ["temporal-library.service", "listRules"], body: `const data = await listRules(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.write", svc: ["temporal-library.service", "createRule"], body: `const data = await createRule(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/rules/[id]", {
  PATCH: { perm: "temporal.write", svc: ["temporal-library.service", "updateRule"], body: `const data = await updateRule(ctxOf(viewer!, ip), id, await readJson(req));` },
  DELETE: { perm: "temporal.write", svc: ["temporal-library.service", "deleteRule"], body: `const data = await deleteRule(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/holidays", {
  GET: { perm: "temporal.read", svc: ["temporal-library.service", "listHolidayCalendars"], body: `const data = await listHolidayCalendars(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.write", svc: ["temporal-library.service", "createHolidayCalendar"], body: `const data = await createHolidayCalendar(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/holidays/[id]", {
  GET: { perm: "temporal.read", svc: ["temporal-library.service", "getHolidays"], body: `const y = req.nextUrl.searchParams.get("year"); const data = await getHolidays(ctxOf(viewer!, ip), id, y ? Number(y) : undefined);` },
});
R("/api/v1/temporal/fiscal", {
  GET: { perm: "temporal.read", svc: ["temporal-library.service", "listFiscalCalendars"], body: `const data = await listFiscalCalendars(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.write", svc: ["temporal-library.service", "upsertFiscalCalendar"], body: `const data = await upsertFiscalCalendar(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/fiscal/period", {
  GET: { perm: "temporal.read", svc: ["temporal-library.service", "fiscalPeriodOf"], body: `const q = req.nextUrl.searchParams; const data = await fiscalPeriodOf(ctxOf(viewer!, ip), q.get("code") ?? "", q.get("at") ?? new Date().toISOString());` },
});
R("/api/v1/temporal/library", {
  GET: { perm: "temporal.read", svc: ["temporal-library.service", "listLibraryTemplates"], body: `const data = await listLibraryTemplates(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.manage", svc: ["temporal-library.service", "upsertLibraryTemplate"], body: `const data = await upsertLibraryTemplate(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/library/[id]/instantiate", {
  POST: { perm: "temporal.write", svc: ["temporal-library.service", "instantiateTemplate"], body: `const data = await instantiateTemplate(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/time-systems", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "listTimeSystems"], body: `const data = await listTimeSystems(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.manage", svc: ["temporal-library.service", "upsertTimeSystem"], body: `const data = await upsertTimeSystem(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/time-systems/convert", {
  GET: { perm: "temporal.read", svc: ["temporal-library.service", "convertTimeSystem"], body: `const data = await convertTimeSystem(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});

// ---- UTP: intelligence & analytics -----------------------------------------------
R("/api/v1/temporal/intelligence/optimize", {
  POST: { perm: "temporal.read", svc: ["temporal-intelligence.service", "optimize"], body: `const data = await optimize(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/intelligence/auto-schedule", {
  POST: { perm: "temporal.write", svc: ["temporal-intelligence.service", "autoSchedule"], body: `const data = await autoSchedule(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/intelligence/replan", {
  POST: { perm: "temporal.write", svc: ["temporal-intelligence.service", "autoReplan"], body: `const data = await autoReplan(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/intelligence/conflicts", {
  GET: { perm: "temporal.read", svc: ["temporal-intelligence.service", "detectConflicts"], body: `const data = await detectConflicts(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/intelligence/forecast", {
  GET: { perm: "temporal.read", svc: ["temporal-intelligence.service", "forecast"], body: `const data = await forecast(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/intelligence/insight", {
  POST: { perm: "temporal.read", svc: ["temporal-intelligence.service", "forecastInsight"], body: `const data = await forecastInsight(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/analytics", {
  GET: { perm: "temporal.read", svc: ["temporal-intelligence.service", "temporalAnalytics"], body: `const data = await temporalAnalytics(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/analytics/trends", {
  GET: { perm: "temporal.read", svc: ["temporal-intelligence.service", "schedulingTrends"], body: `const data = await schedulingTrends(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});

R("/api/v1/temporal/stream/transports", {
  GET: { perm: "temporal.read", svc: ["temporal-stream.service", "listTransports"], body: `const data = await listTransports(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.manage", svc: ["temporal-stream.service", "createTransport"], body: `const data = await createTransport(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/stream/transports/[id]/toggle", {
  POST: { perm: "temporal.manage", svc: ["temporal-stream.service", "setTransportActive"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); const data = await setTransportActive(ctxOf(viewer!, ip), id, active);` },
});
R("/api/v1/temporal/stream/transports/[id]/reset", {
  POST: { perm: "temporal.manage", svc: ["temporal-stream.service", "resetTransportCursor"], body: `const body = await readJson(req).catch(() => ({})); const data = await resetTransportCursor(ctxOf(viewer!, ip), id, (body as { from?: string }).from);` },
});
R("/api/v1/temporal/stream/transports/[id]", {
  DELETE: { perm: "temporal.manage", svc: ["temporal-stream.service", "deleteTransport"], body: `await deleteTransport(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/timeline", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "platformTimeline"], body: `const data = await platformTimeline(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/monitor", {
  GET: { perm: "temporal.read", svc: ["temporal.service", "monitorSchedule"], body: `const data = await monitorSchedule(ctxOf(viewer!, ip));` },
});
R("/api/v1/temporal/adopt-legacy", {
  POST: { perm: "temporal.write", svc: ["temporal.service", "adoptLegacySchedules"], body: `const data = await adoptLegacySchedules(ctxOf(viewer!, ip));` },
});

// ---- UTP: cron sweeps --------------------------------------------------------------
R("/api/v1/cron/reports", {
  POST: {
    auth: "public", rate: "auth",
    svc: ["analytics.service", "runDueReports"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await runDueReports();`,
  },
});
// ---- TPaaS: metering, connectors, widgets, marketplace, branding, i18n, SDK ----
R("/api/v1/temporal/metering/summary", {
  GET: { perm: "subscription.read", svc: ["temporal-metering.service", "usageSummary"], body: `const data = await usageSummary(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/metering/events", {
  GET: { perm: "subscription.read", svc: ["temporal-metering.service", "listUsageEvents"], body: `const data = await listUsageEvents(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/metering/prices", {
  GET: { perm: "settings.read", svc: ["temporal-metering.service", "listMeteredPrices"], body: `const data = await listMeteredPrices(ctxOf(viewer!, ip));` },
  POST: { perm: "settings.manage", svc: ["temporal-metering.service", "upsertMeteredPrice"], body: `const data = await upsertMeteredPrice(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/connectors/templates", {
  GET: { perm: "temporal.read", svc: ["temporal-connectors.service", "listConnectorTemplates"], body: `const data = await listConnectorTemplates(ctxOf(viewer!, ip));` },
  POST: { perm: "temporal.manage", svc: ["temporal-connectors.service", "upsertConnectorTemplate"], body: `const data = await upsertConnectorTemplate(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/connectors", {
  GET: { perm: "temporal.read", svc: ["temporal-connectors.service", "listConnections"], body: `const data = await listConnections(ctxOf(viewer!, ip), req.nextUrl.searchParams.get("calendarId") ?? undefined);` },
  POST: { perm: "temporal.write", svc: ["temporal-connectors.service", "connectCalendar"], body: `const data = await connectCalendar(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/connectors/[id]/sync", {
  POST: { perm: "temporal.write", svc: ["temporal-connectors.service", "syncConnection"], body: `const data = await syncConnection(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/connectors/[id]", {
  DELETE: { perm: "temporal.write", svc: ["temporal-connectors.service", "disconnectCalendar"], body: `const data = await disconnectCalendar(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/widgets", {
  GET: { perm: "temporal.read", svc: ["temporal-widgets.service", "listWidgets"], body: `const data = await listWidgets(ctxOf(viewer!, ip), req.nextUrl.searchParams.get("calendarId") ?? undefined);` },
  POST: { perm: "temporal.write", svc: ["temporal-widgets.service", "createWidget"], body: `const data = await createWidget(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/widgets/[id]", {
  PATCH: { perm: "temporal.write", svc: ["temporal-widgets.service", "updateWidget"], body: `const data = await updateWidget(ctxOf(viewer!, ip), id, await readJson(req));` },
  DELETE: { perm: "temporal.write", svc: ["temporal-widgets.service", "deleteWidget"], body: `const data = await deleteWidget(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/widgets/[id]/toggle", {
  POST: { perm: "temporal.write", svc: ["temporal-widgets.service", "toggleWidget"], extra: [["activeSchema", "@/server/schemas"]], body: `const { active } = activeSchema.parse(await readJson(req)); const data = await toggleWidget(ctxOf(viewer!, ip), id, active);` },
});
R("/api/v1/temporal/widgets/[id]/rotate", {
  POST: { perm: "temporal.write", svc: ["temporal-widgets.service", "rotateWidgetToken"], body: `const data = await rotateWidgetToken(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/public/widget/[token]", {
  GET: { auth: "public", rate: "api", svc: ["temporal-widgets.service", "publicWidget"], body: `const data = await publicWidget(params.token, req.headers.get("origin"));` },
  POST: { auth: "public", rate: "api", svc: ["temporal-widgets.service", "publicWidgetBook"], body: `const data = await publicWidgetBook(params.token, await readJson(req), ip);` },
});
R("/api/v1/temporal/marketplace", {
  GET: { perm: "temporal.read", svc: ["temporal-marketplace.service", "listListings"], body: `const data = await listListings(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
  POST: { perm: "temporal.write", svc: ["temporal-marketplace.service", "createListing"], body: `const data = await createListing(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/marketplace/[id]/publish", {
  POST: { perm: "temporal.write", svc: ["temporal-marketplace.service", "publishListing"], body: `const data = await publishListing(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/marketplace/[id]/retire", {
  POST: { perm: "temporal.write", svc: ["temporal-marketplace.service", "retireListing"], body: `const data = await retireListing(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/marketplace/[id]/certify", {
  POST: { perm: "temporal.manage", svc: ["temporal-marketplace.service", "certifyListing"], body: `const data = await certifyListing(ctxOf(viewer!, ip), id, await readJson(req));` },
});
R("/api/v1/temporal/marketplace/[id]/install", {
  POST: { perm: "temporal.write", svc: ["temporal-marketplace.service", "installListing"], body: `const data = await installListing(ctxOf(viewer!, ip), id);` },
});
R("/api/v1/temporal/marketplace/installs", {
  GET: { perm: "temporal.read", svc: ["temporal-marketplace.service", "listInstalls"], body: `const data = await listInstalls(ctxOf(viewer!, ip), req.nextUrl.searchParams);` },
});
R("/api/v1/temporal/branding", {
  GET: { perm: "settings.read", svc: ["temporal-branding.service", "getBranding"], body: `const data = await getBranding(ctxOf(viewer!, ip));` },
  POST: { perm: "settings.manage", svc: ["temporal-branding.service", "upsertBranding"], body: `const data = await upsertBranding(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/public/branding", {
  GET: { auth: "public", rate: "api", svc: ["temporal-branding.service", "publicBranding"], body: `const data = await publicBranding(req.nextUrl.searchParams.get("domain") ?? new URL(req.url).hostname);` },
});
R("/api/v1/temporal/locales", {
  GET: { perm: "settings.read", svc: ["temporal-branding.service", "listLocales"], body: `const data = await listLocales(ctxOf(viewer!, ip));` },
  POST: { perm: "settings.manage", svc: ["temporal-branding.service", "upsertLocale"], body: `const data = await upsertLocale(ctxOf(viewer!, ip), await readJson(req));` },
});
R("/api/v1/temporal/locales/strings", {
  GET: { perm: "org.read", svc: ["temporal-branding.service", "resolveStrings"], body: `const data = await resolveStrings(ctxOf(viewer!, ip), req.nextUrl.searchParams.get("code") ?? undefined);` },
});
R("/api/v1/temporal/graphql/schema", {
  GET: { perm: "temporal.read", svc: ["temporal-sdk.service", "graphqlSchemaDoc"], body: `const data = await graphqlSchemaDoc();` },
});
R("/api/v1/temporal/sdk", {
  GET: { perm: "temporal.read", svc: ["temporal-sdk.service", "generateSdk"], body: `const data = await generateSdk(req.nextUrl.searchParams.get("language") ?? "typescript");` },
});
R("/api/v1/temporal/sdk/targets", {
  GET: { perm: "temporal.read", svc: ["temporal-sdk.service", "listSdkTargets"], body: `const data = await listSdkTargets();` },
});
R("/api/v1/cron/calendar-sync", {
  POST: {
    auth: "public", rate: "auth",
    svc: ["temporal-connectors.service", "syncDueConnections"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await syncDueConnections();`,
  },
});
R("/api/v1/cron/temporal-stream", {
  POST: {
    auth: "public", rate: "auth",
    svc: ["temporal-stream.service", "streamTemporalEvents"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await streamTemporalEvents();`,
  },
});
R("/api/v1/cron/temporal-triggers", {
  POST: {
    auth: "public", rate: "auth",
    svc: ["temporal-triggers.service", "runTemporalTriggers"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await runTemporalTriggers();`,
  },
});
R("/api/v1/cron/temporal-governance", {
  POST: {
    auth: "public", rate: "auth",
    svc: ["temporal-library.service", "governanceSweep"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await governanceSweep();`,
  },
});
R("/api/v1/cron/temporal-materialize", {
  POST: {
    auth: "public", rate: "auth",
    svc: ["temporal.service", "sweepMaterialize"],
    body: `const { getEnv } = await import("@/server/env"); const { AppError, ErrorCodes } = await import("@/server/errors"); const provided = (req.headers.get("authorization") ?? "").split(" ")[1] ?? ""; if (!getEnv().CRON_SECRET || provided !== getEnv().CRON_SECRET) throw new AppError(ErrorCodes.UNAUTHENTICATED, "Invalid cron secret"); const data = await sweepMaterialize();`,
  },
});

// -----------------------------------------------------------------------
// Emitters
// -----------------------------------------------------------------------

const routeCtxType = (path) => `RouteContext<"${path}">`;
const idParams = (path) => [...path.matchAll(/\[(\w+)\]/g)].map((m) => m[1]);

let fileCount = 0;
for (const r of routes) {
  const dir = `src/app${r.path}`;
  mkdirSync(dir, { recursive: true });
  const imports = new Set();
  imports.add(`import { route } from "@/server/api";`);
  if ([...Object.values(r.methods)].some((m) => m.body.includes("readJson"))) {
    imports.add(`import { readJson } from "@/server/api";`);
  }
  imports.add(`import { ok } from "@/server/serialize";`);
  const needsCtxOf = [...Object.values(r.methods)].some((m) => m.body.includes("ctxOf"));
  if (needsCtxOf) imports.add(`import { ctxOf } from "@/server/services/common";`);
  imports.add(`import type { NextRequest } from "next/server";`);
  for (const m of Object.values(r.methods)) {
    if (m.extra) for (const [sym, from] of m.extra) imports.add(`import { ${sym} } from "${from}";`);
  }
  for (const m of Object.values(r.methods)) {
    for (const [file, fn] of [m.svc.length === 3 ? m.svc : [m.svc[0], m.svc[1]]]) {
      const mod = file === "events" ? "../server/events" : file === "registry" ? "../server/constitution-api" : `../server/services/${file}`;
      imports.add(`import { ${fn} } from "@/${mod.replace("../server/", "server/")}";`);
    }
    if (m.svc[2]) imports.add(`import { ${m.svc[2]} } from "@/server/services/${m.svc[0]}";`);
  }

  const fns = [];
  for (const [method, m] of Object.entries(r.methods)) {
    const params = idParams(r.path);
    const optsParts = [];
    if (m.auth === "public") optsParts.push(`auth: "public"`);
    else optsParts.push(`permission: ${m.perm ? JSON.stringify(m.perm) : "undefined"}`);
    if (m.rate) optsParts.push(`rate: "${m.rate}"`);
    if (m.idem) optsParts.push(`idempotent: true`);
    const bodyLines = [];
    bodyLines.push(`export async function ${method}(`);
    if (params.length) {
      bodyLines.push(`  req: NextRequest,`);
      bodyLines.push(`  ctx: ${routeCtxType(r.path)},`);
      bodyLines.push(`): Promise<Response> {`);
      bodyLines.push(`  const { ${params.join(", ")} } = await ctx.params;`);
    } else {
      bodyLines.push(`  req: NextRequest,`);
      bodyLines.push(`): Promise<Response> {`);
    }
    bodyLines.push(`  return route(`);
    bodyLines.push(`    req,`);
    bodyLines.push(`    { ${optsParts.join(", ")} },`);
    const usesViewer = /\bviewer\b/.test(m.body);
    const usesIp = /\bip\b/.test(m.body);
    const args = usesViewer && usesIp ? "{ viewer, ip }" : usesViewer ? "{ viewer }" : usesIp ? "{ ip }" : "";
    bodyLines.push(`    async (${args}) => {`);
    bodyLines.push(`      ${m.body.replaceAll("params.", "")}`);
    // Emit ok(<the variable the handler actually declared>).
    const decl = /\bconst (result|data)\b/.exec(m.body);
    bodyLines.push(decl ? `      return ok(${decl[1]} ?? null);` : `      return ok(null);`);
    bodyLines.push(`    },`);
    bodyLines.push(`  );`);
    bodyLines.push(`}`);
    fns.push(bodyLines.join("\n"));
  }

  const out = [
    "// AUTO-STRUCTURED API ROUTE — auth, CSRF, rate limit and permissions enforced by route().",
    "",
    [...imports].join("\n"),
    "",
    fns.join("\n\n"),
    "",
  ].join("\n");
  writeFileSync(`${dir}/route.ts`, out);
  fileCount++;
}
console.log(`generated ${fileCount} route files`);
