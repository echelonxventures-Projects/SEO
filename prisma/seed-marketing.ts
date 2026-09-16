/**
 * Marketing suite seed: AI studio engine + prompt templates + brand voices +
 * social/content/links/sites/email demo data. Idempotent.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encryptSecret } from "../src/server/crypto";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const TEMPLATES: Array<{ key: string; kind: never | string; title: string; body: string }> = [
  {
    key: "blog_outline", kind: "BLOG_OUTLINE", title: "Blog outline",
    body: "Create a focused content outline for the topic. Structure: H1, five H2 sections, one takeaway per section, a CTA ending. Vary angles; avoid generic intros.\n\nTopic: {{topic}}\nKeywords: {{keywords}}\nAudience: {{audience}}",
  },
  {
    key: "blog_draft", kind: "BLOG_DRAFT", title: "SEO blog article",
    body: "Write a complete, publish-ready blog article in markdown. First line: '# <title>'. Second line: '_Meta: <one-sentence description using the main keyword>._'. Then an H2-structured article of ~800 words with concrete steps, a short table or checklist, natural keyword usage (never stuffed), and a conclusion with one CTA. No fluff intros.\n\nTopic: {{topic}}\nKeywords: {{keywords}}\nAudience: {{audience}}\nBrand context: {{clientName}}",
  },
  {
    key: "ad_copy", kind: "AD_COPY", title: "Ad copy variants",
    body: "Return STRICT JSON only: {\"platform\":\"...\",\"ads\":[{\"variant\":1,\"headline\":\"<=30 chars for google, <=40 for meta\",\"description\":\"<=90 chars\",\"primaryText\":\"1-3 sentences\",\"callToAction\":\"2 words\"}]}. Write {{variants}} variants. Match the platform rules. Benefit-led, specific, no clickbait.\n\nPlatform: {{platform}}\nCampaign: {{campaignName}}\nAudience: {{audience}}\nDestination: {{destination}}",
  },
  {
    key: "social_caption", kind: "SOCIAL_CAPTION", title: "Social captions",
    body: "Write {{variants}} distinct social captions for this topic. Each: strong 1-line hook, 2-4 short lines max, one engagement line, no hashtag spam. Plain text separated by a '———' line.\n\nTopic: {{topic}}\nAudience: {{audience}}",
  },
  {
    key: "voiceover_script", kind: "VOICEOVER_SCRIPT", title: "Voiceover script",
    body: "Write a {{length}} voiceover script for a video ad. Format with timecodes and bracketed direction cues [HOOK]/[PROBLEM]/[SOLUTION]/[PROOF]/[CTA]. Sentences under 14 words. Natural spoken rhythm.\n\nTopic: {{topic}}\nCampaign: {{campaignName}}\nAudience: {{audience}}",
  },
  {
    key: "image_prompt", kind: "IMAGE_PROMPT", title: "Image art direction",
    body: "Write ONE image-generation prompt for an ad creative: composition, lighting, style, palette, negative space for text, aspect {{platform}} best practice. No brand names, no text rendering requests.\n\nTopic: {{topic}}\nCampaign: {{campaignName}}",
  },
  {
    key: "newsletter", kind: "NEWSLETTER", title: "Newsletter issue",
    body: "Write a short newsletter issue in markdown: subject line first ('Subject: ...'), greeting 'Hi there,', one idea, one proof, one action, sign-off '— {{brand}}'. Keep under 220 words. Leave {{unsubscribeUrl}} note out.\n\nTopic: {{topic}}\nCampaign: {{campaignName}}",
  },
  {
    key: "keyword_ideas", kind: "KEYWORD_IDEAS", title: "Keyword expansion",
    body: "List 12 long-tail keyword ideas (one per line, lowercase) around the topic for this audience. Mix problem, comparison and local intent.\n\nTopic: {{topic}}\nAudience: {{audience}}",
  },
];

const iso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3600_000).toISOString();

const PIXEL_TEMPLATES: Array<{ key: string; label: string; placement: string; docUrl: string | null; body: string }> = [
  {
    key: "GOOGLE_ANALYTICS", label: "Google Analytics 4 (gtag.js)", placement: "HEAD", docUrl: "https://developers.google.com/analytics",
    body: `<!-- Google tag (gtag.js) -->\n<script async src="https://www.googletagmanager.com/gtag/js?id={{pixelId}}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','{{pixelId}}');</script>`,
  },
  {
    key: "META_PIXEL", label: "Meta Pixel", placement: "HEAD", docUrl: "https://developers.facebook.com/docs/meta-pixel",
    body: `<!-- Meta Pixel -->\n<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','{{pixelId}}');fbq('track','PageView');</script>`,
  },
  {
    key: "TIKTOK_PIXEL", label: "TikTok Pixel", placement: "HEAD", docUrl: "https://ads.tiktok.com/help/article/tiktok-pixel",
    body: `<!-- TikTok Pixel -->\n<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.load('{{pixelId}}');ttq.page();}(window,document,'ttq');</script><script async src="https://analytics.tiktok.com/i18n/pixel/events.js"></script>`,
  },
  {
    key: "LINKEDIN_INSIGHT", label: "LinkedIn Insight Tag", placement: "HEAD", docUrl: "https://www.linkedin.com/help/lms",
    body: `<!-- LinkedIn Insight Tag -->\n<script>_linkedin_partner_id="{{pixelId}}";window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);</script><script async src="https://snap.licdn.com/li.lms-analytics/insight.min.js"></script>`,
  },
  {
    key: "PINTEREST_TAG", label: "Pinterest Tag", placement: "HEAD", docUrl: "https://help.pinterest.com/en/business/article/install-the-pinterest-tag",
    body: `<!-- Pinterest Tag -->\n<script>!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var t=document.createElement("script");t.async=1,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");pintrk("load","{{pixelId}}");pintrk("page");</script>`,
  },
];

export async function seedMarketing(orgId: string, userId: string, clientIds: Record<string, string>) {
  // 0a. backfill: pre-template pixels are linked to their platform's global
  // template so legacy rows render through the same data path.
  await db.$executeRawUnsafe(`
    UPDATE "TrackingPixel" p
    SET "templateId" = t.id
    FROM "PixelTemplate" t
    WHERE p."templateId" IS NULL
      AND p."platform" <> 'CUSTOM'
      AND t."orgId" IS NULL
      AND t.key = p.platform::text
      AND t.active;
  `);

  // 0. pixel tag templates (global) — snippet shapes as editable data
  for (const t of PIXEL_TEMPLATES) {
    const existing = await db.pixelTemplate.findFirst({ where: { orgId: null, key: t.key } });
    if (existing) {
      await db.pixelTemplate.update({
        where: { id: existing.id },
        data: { label: t.label, body: t.body, placement: t.placement as never, docUrl: t.docUrl, active: true },
      });
    } else {
      await db.pixelTemplate.create({
        data: { orgId: null, key: t.key, label: t.label, body: t.body, placement: t.placement as never, docUrl: t.docUrl },
      });
    }
  }
  // 1. prompt templates (global)
  for (const t of TEMPLATES) {
    const existing = await db.promptTemplate.findFirst({ where: { orgId: null, key: t.key } });
    if (existing) continue;
    await db.promptTemplate.create({
      data: { orgId: null, key: t.key, kind: t.kind as never, title: t.title, body: t.body },
    });
  }

  // 2. AI routing policy — pure seed data, zero code branching:
  //    priority ascending = attempt order. Free-tier engines first; the demo
  //    engine last (always-available fallback). Premium adapters carry
  //    requiredFeature=AI_PREMIUM so only plans that include it can reach them.
  const ROUTING: Array<{
    providerCode: string;
    label: string;
    baseUrl: string | null;
    textModel: string;
    imageModel: string;
    priority: number;
    requiredFeature: string | null;
    keyEnv: string | null;
  }> = [
    { providerCode: "google", label: "Google Gemini (free tier)", baseUrl: null, textModel: "gemini-2.5-flash", imageModel: "gemini-2.5-flash-image", priority: 10, requiredFeature: null, keyEnv: "GEMINI_API_KEY" },
    { providerCode: "openai", label: "Groq · Llama (free tier)", baseUrl: "https://api.groq.com/openai/v1", textModel: "llama-3.3-70b-versatile", imageModel: "", priority: 20, requiredFeature: null, keyEnv: "GROQ_API_KEY" },
    { providerCode: "openai", label: "OpenAI (premium)", baseUrl: null, textModel: "gpt-4o-mini", imageModel: "gpt-image-1", priority: 40, requiredFeature: "AI_PREMIUM", keyEnv: "OPENAI_API_KEY" },
    { providerCode: "anthropic", label: "Anthropic Claude (premium)", baseUrl: null, textModel: "claude-sonnet-4-20250514", imageModel: "", priority: 50, requiredFeature: "AI_PREMIUM", keyEnv: "ANTHROPIC_API_KEY" },
    { providerCode: "demo", label: "Demo engine (sandbox fallback)", baseUrl: null, textModel: "demo-writer-v1", imageModel: "demo-poster", priority: 999, requiredFeature: null, keyEnv: "always" },
  ];
  for (const r of ROUTING) {
    const apiKey = r.keyEnv === "always" ? "demo-key" : process.env[r.keyEnv ?? ""] ?? null;
    if (!apiKey) continue; // only real providers whose keys were supplied
    const existing = await db.aiModelConfig.findFirst({
      where: { orgId: null, providerCode: r.providerCode, label: r.label },
    });
    const aad = (id: string) => `ai:platform:${r.providerCode}:${id}`;
    const baseData = {
      orgId: null,
      providerCode: r.providerCode,
      label: r.label,
      baseUrl: r.baseUrl,
      textModel: r.textModel,
      imageModel: r.imageModel,
      priority: r.priority,
      requiredFeature: r.requiredFeature as never,
      active: true,
    };
    if (existing) {
      await db.aiModelConfig.update({
        where: { id: existing.id },
        data: { ...baseData, apiKeyEnc: encryptSecret(JSON.stringify({ apiKey }), aad(existing.id)) },
      });
      continue;
    }
    const created = await db.aiModelConfig.create({
      data: { ...baseData, apiKeyEnc: encryptSecret(JSON.stringify({ apiKey }), "ai:pending") },
    });
    await db.aiModelConfig.update({
      where: { id: created.id },
      data: { apiKeyEnc: encryptSecret(JSON.stringify({ apiKey }), aad(created.id)) },
    });
  }

  // 3. brand voice for the demo workspace
  const voice = await db.brandVoice.findFirst({ where: { orgId, name: "AIthink house style" } });
  if (!voice) {
    await db.brandVoice.create({
      data: {
        orgId,
        name: "AIthink house style",
        tone: "confident, plain-spoken, numbers over adjectives, zero jargon",
        audience: "Indian students and small-business owners who want AI-driven marketing results",
        vocabularyDo: ["system", "proof", "outcome", "playbook"],
        vocabularyDont: ["synergy", "game-changer", "revolutionary"],
        bannedClaims: "No income guarantees, no cure claims, no fake scarcity",
        isDefault: true,
      },
    });
  }

  // 4. demo social connection
  const demoCon = await db.socialConnection.upsert({
    where: { orgId_connectorKey_externalAccountId: { orgId, connectorKey: "demo", externalAccountId: "demo-channel" } },
    create: {
      orgId,
      connectorKey: "demo",
      externalAccountId: "demo-channel",
      handle: "Demo Channel",
      displayName: "Demo Channel (sandbox)",
      accessTokenEnc: encryptSecret("demo", `social:${orgId}:demo:pending`),
      connectedById: userId,
    },
    update: {},
  });
  await db.socialConnection.update({
    where: { id: demoCon.id },
    data: { accessTokenEnc: encryptSecret("demo", `social:${orgId}:demo:${demoCon.id}`) },
  });

  // 5. scheduled demo post (queued — publisher cron publishes it end-to-end)
  const postCount = await db.contentPost.count({ where: { orgId } });
  if (postCount === 0) {
    await db.contentPost.create({
      data: {
        orgId,
        title: "Diwali offer — teaser",
        body: "This Diwali, light up your funnel 🪔 — our SEO audit slots are open for November. Limited, genuinely.",
        hashtags: ["diwali", "seo"],
        status: "SCHEDULED",
        createdById: userId,
        targets: {
          create: [
            { connectionId: demoCon.id, orgId, scheduledAt: new Date(iso(26)) },
          ],
        },
      },
    });
  }

  // 6. tracked link with campaign UTMs
  const campaign = await db.campaign.findFirst({ where: { orgId }, orderBy: { createdAt: "desc" } });
  const linkExists = await db.trackedLink.findFirst({ where: { orgId } });
  if (!linkExists) {
    await db.trackedLink.create({
      data: {
        orgId,
        code: "diwaliof",
        label: "Instagram bio — Diwali offer",
        destination: "https://aithink.india/diwali",
        campaignId: campaign?.id ?? null,
        utmSource: "instagram",
        utmMedium: campaign ? "paid" : "organic",
        utmCampaign: campaign?.name ?? "diwali-2026",
        createdById: userId,
      },
    });
  }

  // 7. web property + pixels (bundle renders from DB template rows — link them)
  const lumenId = clientIds.lumen;
  if (lumenId) {
    let prop = await db.webProperty.findFirst({ where: { orgId } });
    if (!prop) {
      prop = await db.webProperty.create({
        data: {
          orgId,
          clientId: lumenId,
          name: "Lumen main site",
          domain: "lumen.example",
          ga4MeasurementId: "G-DEMO0001",
          verification: "VERIFIED",
        },
      });
    }
    const metaTpl = await db.pixelTemplate.findFirst({ where: { orgId: null, key: "META_PIXEL" } });
    const gaTpl = await db.pixelTemplate.findFirst({ where: { orgId: null, key: "GOOGLE_ANALYTICS" } });
    for (const [tpl, platform, id] of [[metaTpl, "META_PIXEL", "1234567890"], [gaTpl, "GOOGLE_ANALYTICS", "G-DEMO0001"]] as const) {
      if (!tpl) continue;
      const exists = await db.trackingPixel.findFirst({ where: { propertyId: prop.id, platform: platform as never } });
      if (!exists) {
        await db.trackingPixel.create({
          data: { propertyId: prop.id, orgId, platform: platform as never, label: tpl.label, pixelId: id, placement: tpl.placement, templateId: tpl.id },
        });
      } else if (!exists.templateId) {
        await db.trackingPixel.update({ where: { id: exists.id }, data: { templateId: tpl.id } });
      }
    }
  }

  // 8. mailing list + subscribers + draft campaign
  const listExists = await db.mailingList.findFirst({ where: { orgId } });
  if (!listExists) {
    const list = await db.mailingList.create({
      data: { orgId, name: "Growth Letter", doubleOptIn: true, welcomeSubject: "Welcome to the Growth Letter", welcomeBody: "Hi {{name}} — you're in. Expect one sharp idea every Friday.\n\n— AIthink" },
    });
    const emails = [
      { email: "reader1@example.com", name: "Riya" },
      { email: "reader2@example.com", name: "Arjun" },
      { email: "reader3@example.com", name: "Meera" },
    ];
    for (const s of emails) {
      await db.subscriber.create({
        data: {
          listId: list.id,
          orgId,
          email: s.email,
          emailNormalized: s.email.toLowerCase(),
          name: s.name,
          status: "SUBSCRIBED",
          subscribedAt: new Date(),
          source: "import",
        },
      });
    }
    await db.emailCampaign.create({
      data: {
        orgId,
        listId: list.id,
        subject: "One SEO change that moved 40% of our traffic",
        preheader: "A 3-line case study, this week's action, and one link worth clicking",
        bodyMarkdown:
          "# The week in growth\n\nHi there,\n\nThis week we moved **40% more organic traffic** with a single change: we rewrote the top-10 landing pages around the *job the reader is hiring the page to do*.\n\n## The takeaway\n\nRankings follow relevance, relevance follows intent-matched copy.\n\n## Your one action\n\nPick your most visited page. Rewrite its H1 as an outcome, not a feature. Ship it this week.\n\n— AIthink",
        createdById: userId,
      },
    });
  }
}
