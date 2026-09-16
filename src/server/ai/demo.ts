import { createHash } from "node:crypto";
import type { AiModelConfig } from "@/generated/prisma/client";
import type { AiProviderAdapter, TextRequest, TextResult } from "./types";

/**
 * Demo engine — fully offline, deterministic-but-varied text generation used
 * for sandbox workspaces, tests and evaluation without any external API.
 *
 * It renders REAL usable copy: it composes sections from the request context
 * (topic, audience, brand voice, platform rules) with seeded variation, so
 * output is coherent, on-brief and reproducible per (job, seed). It is always
 * labelled provider=DEMO downstream; nothing pretends to be model output.
 */
function seedOf(...parts: unknown[]): number {
  const h = createHash("sha256").update(parts.join("|")).digest();
  return h.readUInt32BE(0);
}

function pick<T>(seed: number, i: number, arr: T[]): T {
  return arr[(seed + i * 7919) % arr.length];
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const demoProvider: AiProviderAdapter = {
  code: "demo",
  label: "Demo studio (offline)",
  async text(cfg: AiModelConfig, _apiKey: string, req: TextRequest): Promise<TextResult> {
    void cfg;
    const user = req.user;
    const topic = extract(user, "Topic") || "your topic";
    const audience = extract(user, "Audience") || "busy decision-makers";
    const keywords = extract(user, "Keywords") || topic;
    const platform = extract(user, "Platform") || "blog";
    const campaign = extract(user, "Campaign") || topic;
    const tone = extract(user, "Tone") || "clear and confident";
    const count = Number(extract(user, "Variants") || "3") || 3;
    const kind = detectKind(user);
    const seed = seedOf(user);

    let out = "";
    if (kind === "BLOG_OUTLINE") {
      const angles = [
        `Why ${titleCase(topic)} matters for ${audience} in ${new Date().getFullYear()}`,
        `The 5-step framework we use for ${topic}`,
        `Common ${topic} mistakes (and the fix for each)`,
        `A realistic 30-day ${topic} plan`,
        `Measuring ${topic}: the only numbers worth watching`,
      ];
      out = `# ${titleCase(topic)} — Outline\n\n` + angles.slice(0, 5).map((a, i) => `${i + 1}. ${a}`).join("\n");
    } else if (kind === "BLOG_DRAFT") {
      const kw = keywords.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 5);
      out =
        `# ${titleCase(topic)}\n\n` +
        `_Meta: ${titleCase(topic)} explained for ${audience}. Keywords: ${kw.slice(0, 3).join(", ") || topic}._\n\n` +
        `If you are a ${audience.replace(/s$/, "")} trying to get ${topic} right, you have probably seen the same tired advice repeated everywhere. This guide is different: it is short, specific and built around outcomes.\n\n` +
        `## ${titleCase(topic)}: what actually moves the needle\n\n` +
        `Three levers consistently outperform everything else — clarity of offer, distribution and proof. Most teams invert that order and wonder why results plateau.\n\n` +
        pick(seed, 1, [
          "Start with one measurable goal for the next 30 days, then work backwards from it.",
          "Pick the channel your audience already trusts; depth beats breadth every time.",
          "Document before you create: one asset, ten derivatives.",
        ]) +
        `\n\n## A 30-day plan\n\n` +
        `**Week 1 — Audit.** Baseline where you are on ${kw[0] ?? topic}. Write down the numbers you will improve.\n` +
        `**Week 2 — Build.** Produce one flagship asset around ${kw[1] ?? topic}. Solve a narrow problem completely.\n` +
        `**Week 3 — Distribute.** ${pick(seed, 2, ["Publish natively on two channels and link back.", "Partner with one complementary brand for shared reach.", "Repost the strongest 20% of the asset as micro-content."])}\n` +
        `**Week 4 — Measure.** ${pick(seed, 3, ["Compare against the week-1 baseline and cut what did not move.", "Double the budget on the single best performer.", "Turn results into a public case study."])}\n\n` +
        `## Mistakes to avoid\n\n` +
        `- Chasing ${kw[2] ?? "vanity metrics"} instead of pipeline.\n` +
        `- Launching without a distribution plan attached.\n` +
        `- Quitting at week three — ${topic} compounds after it starts.\n\n` +
        `## Conclusion\n\n` +
        `Treat ${topic} as a system, not a campaign: one goal, one flagship asset, relentless distribution. Revisit these numbers next month and the direction of travel will be obvious.`;
    } else if (kind === "AD_COPY") {
      const ads = Array.from({ length: count }).map((_, i) => {
        const hooks = [
          `${titleCase(campaign)} without the guesswork`,
          `The ${campaign} upgrade ${audience.replace(/s$/, "")} have been waiting for`,
          `Stop losing to slow ${campaign} processes`,
          `Results on ${campaign} — or we work for free`,
          `Built for ${audience}: ${campaign}, done right`,
        ];
        const desc = [
          `See how teams near ${audience} win with ${campaign}. Book a 15-min demo.`,
          `Trusted by teams like yours. Real ${campaign} outcomes in 30 days.`,
          `One platform for ${campaign}: plan, run, measure. Start free today.`,
        ];
        return {
          variant: i + 1,
          headline: pick(seed, i, hooks).slice(0, 90),
          description: pick(seed, i + 2, desc).slice(0, 90),
          primaryText: pick(seed, i + 4, [
            `Most ${audience} waste weeks on ${campaign} tools that never ship. This one goes live the same day — with proof at every step.`,
            `${titleCase(campaign)} should be measurable by Friday. Ours is. That is why ${audience} switch.`,
          ]),
          callToAction: pick(seed, i + 6, ["Book a demo", "Start free", "See pricing", "Get the guide"]),
        };
      });
      out = JSON.stringify({ platform, ads });
    } else if (kind === "SOCIAL_CAPTION") {
      out = Array.from({ length: count })
        .map((_, i) =>
          pick(seed, i, [
            `Hot take: ${topic} is 80% distribution.\n\nHere is the 20% that changes everything 👇`,
            `We did ${topic} for 30 days. The results surprised us — mostly because nothing “expert” predicted them.`,
            `${titleCase(topic)} is not a trend. It is a margin question.\n\n3 things we changed this quarter:`,
            `If your ${topic} strategy fits on one sticky note, good. Complexity is where budgets go to die.`,
          ]) +
            `\n\n${pick(seed, i + 1, ["Like this? Follow for weekly teardowns.", "Save this for your next planning session.", "What would you add? Comments open."])}`,
        )
        .join("\n———\n");
    } else if (kind === "VOICEOVER_SCRIPT") {
      out =
        `# VO (target: ${extract(user, "Seconds") || "30"}s, tone: ${tone})\n\n` +
        `[0:00 HOOK]  ${pick(seed, 1, ["What if ", "Imagine ", "Here is the truth: "])}${topic} actually worked the way it is supposed to?\n` +
        `[0:05 PROBLEM] ${pick(seed, 2, ["Most teams settle for slow, noisy and unverifiable.", "You have been sold dashboards, not outcomes.", "Everyone talks; almost nobody ships."])}\n` +
        `[0:12 SOLUTION] ${titleCase(campaign)}${pick(seed, 3, [" puts the control back in your hands.", " measures what matters from day one.", " works while your competitors meeting about it."])}\n` +
        `[0:22 PROOF]  ${pick(seed, 4, ["Teams like yours report results inside the first month.", "No contracts. No setup theatre. Just signal.", "Trusted across the industry — and audited monthly."])}\n` +
        `[0:28 CTA]    ${pick(seed, 5, ["Try it free today.", "Book a demo now.", "Start with the free guide."])}`;
    } else if (kind === "IMAGE_PROMPT") {
      out = `High-contrast commercial photograph for ${platform}: ${topic}, ${audience} in context, ${tone} mood, shallow depth of field, negative space for headline text, brand-safe palette, no text artifacts, 16:9`;
    } else if (kind === "NEWSLETTER") {
      out =
        `Subject: ${titleCase(campaign)} — what moved this week\n\n` +
        `Hi {{firstName}},\n\n` +
        `Quick one. This week on ${campaign}: ${pick(seed, 1, ["we cut a step out of the process and results got faster.", "two readers asked the same sharp question — answer below.", "a small change on ${topic} produced a big number."])}\n\n` +
        `**The insight:** ${pick(seed, 2, ["Distribution beats polish. Always.", "Your first 10 users are a research team, not a revenue line.", "Measure weekly, decide monthly, pivot quarterly."])}\n\n` +
        `**One action:** ${pick(seed, 3, ["Rewrite your headline around the outcome, not the feature.", "Reply with your biggest ${topic} blocker — we read everything.", "Run the 30-day plan from last week's edition."])}\n\n` +
        `— ${extract(user, "Brand") || "The team"}\n\n` +
        `Unsubscribe: {{unsubscribeUrl}}`;
    } else {
      out = Array.from({ length: 8 })
        .map((_, i) => pick(seed, i, [
          `${topic} for ${audience.replace(/s$/, "")}`,
          `best ${topic} services`,
          `${topic} strategy template`,
          `how to measure ${topic}`,
          `${topic} agency pricing`,
          `${topic} checklist 2026`,
          `${topic} case study`,
          `${topic} tools comparison`,
        ]))
        .join("\n");
    }
    const tokensIn = Math.ceil(req.user.length / 4);
    return { text: out, tokensIn, tokensOut: Math.ceil(out.length / 4) };
  },

  async image(_cfg, _key, req) {
    // Returned as a local route that renders a deterministic SVG poster —
    // a real image asset, clearly demo-flagged, with zero external calls.
    const token = createHash("sha1").update(req.prompt).digest("hex").slice(0, 16);
    return { url: `/api/v1/public/ai/demo-image/${token}?p=${encodeURIComponent(req.prompt.slice(0, 160))}` };
  },
};

function detectKind(user: string): string {
  const m = user.match(/^TASK: ([A-Z_]+)/);
  return m ? m[1] : "KEYWORD_IDEAS";
}

function extract(user: string, label: string): string | null {
  const m = user.match(new RegExp(`${label}: ([^\\n]+)`));
  return m ? m[1].trim() : null;
}
