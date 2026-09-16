"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Card, CardHeader, Field, Input, Select, Textarea, Badge, EmptyState } from "@/components/ui";
import { toast } from "@/components/toast";
import { cn } from "@/lib/utils";
import { PenLine, Megaphone, Share2, Mic, Image as ImageIcon, Mail, Wand2 } from "lucide-react";

type Client = { id: string; name: string };
type Campaign = { id: string; name: string };
type Job = {
  id: string;
  kind: string;
  provider: string;
  modelCode: string;
  status: string;
  outputText: string | null;
  outputJson: unknown;
  outputUrl: string | null;
  input: { topic?: string } | null;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
  createdBy?: { name: string };
};
type Ad = { variant: number; headline: string; description: string; primaryText: string; callToAction: string };

const MODES = [
  { kind: "BLOG_DRAFT", label: "Blog article", icon: PenLine, desc: "Full SEO article from a topic + keywords" },
  { kind: "BLOG_OUTLINE", label: "Blog outline", icon: PenLine, desc: "H2 structure ready for a writer" },
  { kind: "AD_COPY", label: "Ad copy", icon: Megaphone, desc: "Headlines, primary text, CTA variants" },
  { kind: "SOCIAL_CAPTION", label: "Social captions", icon: Share2, desc: "Scroll-stopping captions with hooks" },
  { kind: "VOICEOVER_SCRIPT", label: "Voiceover", icon: Mic, desc: "Timed video ad script (+ audio if provider supports)" },
  { kind: "IMAGE", label: "Image creative", icon: ImageIcon, desc: "Art-directed poster from your brief" },
  { kind: "NEWSLETTER", label: "Newsletter", icon: Mail, desc: "Issue draft ready for email campaigns" },
] as const;

export default function StudioPage() {
  const router = useRouter();
  const [mode, setMode] = useState<(typeof MODES)[number]["kind"]>("BLOG_DRAFT");
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [clientId, setClientId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [platform, setPlatform] = useState("google_search");
  const [seconds, setSeconds] = useState("30");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [history, setHistory] = useState<Job[]>([]);

  useEffect(() => {
    api.get<{ rows: Client[] }>("/clients?pageSize=200").then((r) => setClients(r.rows)).catch(() => {});
    api.get<{ rows: Campaign[] }>("/campaigns?pageSize=200").then((r) => setCampaigns(r.rows)).catch(() => {});
    api.get<Job[]>("/studio/jobs").then(setHistory).catch(() => {});
  }, []);

  async function generate() {
    if (!topic.trim()) {
      toast("error", "Describe the topic first");
      return;
    }
    setBusy(true);
    setJob(null);
    try {
      const j = await api.post<Job>("/studio/generate", {
        kind: mode,
        topic: topic.trim(),
        keywords,
        clientId: clientId || null,
        campaignId: campaignId || null,
        platform,
        seconds: Number(seconds) || 30,
      });
      setJob(j);
      api.get<Job[]>("/studio/jobs").then(setHistory).catch(() => {});
      toast("success", "Generated");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  const ads: Ad[] = (() => {
    const parsed = job?.outputText ? safeJson<{ ads?: Ad[] }>(job.outputText) : null;
    return parsed?.ads ?? (Array.isArray(job?.outputJson) ? (job?.outputJson as Ad[]) : (parsed?.ads as Ad[] | undefined) ?? []);
  })();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">AI Creative Studio</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Blogs, ads, captions, voiceovers and images — on your brand voice, ready to save into delivery.{" "}
          <Link href="/settings?tab=ai" className="underline">Provider setup</Link>
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="1 · What are we making?" />
          <div className="grid grid-cols-1 gap-1.5 p-3">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.kind}
                  onClick={() => setMode(m.kind)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-2.5 text-left transition-colors",
                    mode === m.kind
                      ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800"
                      : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 text-zinc-500" />
                  <span>
                    <span className="block text-sm font-medium">{m.label}</span>
                    <span className="block text-xs text-zinc-400">{m.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="2 · Brief" description="Everything below feeds your brand-voice prompt template" />
          <div className="space-y-3 p-4">
            <Field label="Topic / product / offer">
              <Textarea rows={2} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Local SEO packages for dental clinics in Mumbai" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Keywords"><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="dental seo mumbai, …" /></Field>
              <Field label="Client (brand voice source)">
                <Select value={clientId} onChange={(e) => setClientId(e.target.value)} options={[{ value: "", label: "Workspace default" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]} />
              </Field>
              <Field label="Attach to campaign">
                <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} options={[{ value: "", label: "None" }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]} />
              </Field>
              {mode === "AD_COPY" && (
                <Field label="Ad platform">
                  <Select value={platform} onChange={(e) => setPlatform(e.target.value)} options={[
                    { value: "google_search", label: "Google Search" },
                    { value: "meta", label: "Meta" },
                    { value: "linkedin", label: "LinkedIn" },
                    { value: "youtube", label: "YouTube" },
                  ]} />
                </Field>
              )}
              {mode === "VOICEOVER_SCRIPT" && (
                <Field label="Spot length (seconds)"><Input type="number" min={10} max={120} value={seconds} onChange={(e) => setSeconds(e.target.value)} /></Field>
              )}
            </div>
            <Button loading={busy} onClick={generate} className="w-full">
              <Wand2 className="h-4 w-4" /> {busy ? "Generating…" : `Generate ${MODES.find((m) => m.kind === mode)?.label.toLowerCase() ?? ""}`}
            </Button>
          </div>
        </Card>
      </div>

      {job && (
        <Card className="mt-4">
          <CardHeader
            title={`3 · Result — ${MODES.find((m) => m.kind === job.kind)?.label ?? job.kind.toLowerCase()}`}
            description={`${job.tokensIn + job.tokensOut} tokens · ${job.provider.toLowerCase()} · ${job.modelCode}`}
            actions={
              <div className="flex gap-2">
                {job.kind === "BLOG_DRAFT" && (
                  <SaveBlogButton topic={topic} job={job} clientId={clientId} onDone={() => router.push("/blogs")} />
                )}
                {job.kind === "AD_COPY" && campaignId && ads.length > 0 && (
                  <SaveAdsButton campaignId={campaignId} job={job} ads={ads} platform={platform} />
                )}
                {(job.kind === "IMAGE" || job.kind === "VOICEOVER_SCRIPT") && job.outputUrl && null}
              </div>
            }
          />
          {job.outputUrl && (
            <div className="border-b border-zinc-100 p-4 dark:border-zinc-800">
              <img src={job.outputUrl} alt="Generated creative" className="w-full max-w-lg rounded-lg border border-zinc-200 dark:border-zinc-700" />
            </div>
          )}
          <div className="p-4">
            {ads.length > 0 ? (
              <div className="space-y-3">
                {ads.map((a, i) => (
                  <div key={i} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                    <p className="text-xs text-zinc-400">Variant {a.variant ?? i + 1}</p>
                    <p className="mt-1 font-semibold">{a.headline}</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">{a.primaryText}</p>
                    <p className="mt-1 text-sm text-zinc-500">{a.description}</p>
                    <Badge className="mt-2 bg-violet-500/10 text-violet-600">{a.callToAction}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{job.outputText}</pre>
            )}
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader title="Recent jobs" />
        {history.length === 0 ? (
          <EmptyState title="Nothing generated yet" />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {history.slice(0, 8).map((j) => (
              <li key={j.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{j.kind.toLowerCase().replace(/_/g, " ")} <span className="text-zinc-400">· {j.createdBy?.name ?? ""}</span></p>
                  <p className="truncate text-xs text-zinc-400">{(j.input as { topic?: string })?.topic ?? ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={j.status === "SUCCEEDED" ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"}>{j.status.toLowerCase()}</Badge>
                  <button className="text-xs text-zinc-500 hover:underline" onClick={() => setJob(j)}>View</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s.replace(/^```json?/i, "").replace(/```$/m, "").trim()) as T;
  } catch {
    return null;
  }
}

function SaveBlogButton({ topic, job, clientId, onDone }: { topic: string; job: Job; clientId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const text = job.outputText ?? "";
          const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? topic.slice(0, 60);
          const meta = text.match(/^_Meta:\s*(.+?)\._/m)?.[1]?.slice(0, 280) ?? null;
          const body = text.replace(/^_Meta:.*\n/m, "").trim();
          await api.post("/blogs", {
            title,
            bodyMarkdown: body,
            metaDescription: meta,
            jobId: job.id,
            clientId: clientId || null,
            keywords: [],
          });
          toast("success", "Saved as blog draft");
          onDone();
        } catch (e) {
          toast("error", e instanceof Error ? e.message : "Save failed");
          setBusy(false);
        }
      }}
    >
      Save as blog draft
    </Button>
  );
}

function SaveAdsButton({ campaignId, job, ads, platform }: { campaignId: string; job: Job; ads: Ad[]; platform: string }) {
  const [busy, setBusy] = useState(false);
  const platMap: Record<string, "GOOGLE_SEARCH" | "GOOGLE_DISPLAY" | "META" | "LINKEDIN" | "YOUTUBE"> = {
    google_search: "GOOGLE_SEARCH", meta: "META", linkedin: "LINKEDIN", youtube: "YOUTUBE",
  };
  return (
    <Button
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          for (const a of ads) {
            await api.post("/creatives", {
              campaignId,
              platform: platMap[platform] ?? "GOOGLE_SEARCH",
              headline: a.headline,
              description: a.description ?? null,
              primaryText: a.primaryText ?? null,
              callToAction: a.callToAction ?? null,
              jobId: job.id,
            });
          }
          toast("success", `${ads.length} creative variants saved to the campaign`);
        } catch (e) {
          toast("error", e instanceof Error ? e.message : "Save failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      Save {ads.length} variants → campaign
    </Button>
  );
}

