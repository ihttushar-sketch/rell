/**
 * Thin client for the Python production node.
 *
 * All calls are origin-relative (`/api/...`) and proxied server-side by the
 * Next rewrite, so the studio works through any preview host without CORS or
 * localhost references in browser code.
 */

import { Capabilities, FrameworkDna, Job, ProduceOptions, RenderPlan } from "./types";

export const API_ROOT = "/api";

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
  }
  return (await response.json()) as T;
}

export async function fetchCapabilities(): Promise<Capabilities | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(`${API_ROOT}/health`, { signal: controller.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = (await response.json()) as Capabilities;
    return data.engine === "server" ? data : null;
  } catch {
    return null;
  }
}

export function listFrameworks(): Promise<FrameworkDna[]> {
  return jsonFetch<{ frameworks: FrameworkDna[] }>("/frameworks").then((r) => r.frameworks ?? []);
}

export function saveFramework(dna: FrameworkDna): Promise<FrameworkDna> {
  return jsonFetch<FrameworkDna>("/frameworks", { method: "POST", body: JSON.stringify(dna) });
}

export function deleteFramework(id: string): Promise<void> {
  return jsonFetch<{ ok: boolean }>(`/frameworks/${encodeURIComponent(id)}`, { method: "DELETE" }).then(() => undefined);
}

export function importFrameworks(payload: FrameworkDna | { frameworks: FrameworkDna[] }): Promise<FrameworkDna[]> {
  return jsonFetch<{ frameworks: FrameworkDna[] }>("/frameworks/import", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((r) => r.frameworks ?? []);
}

export function getJob(id: string): Promise<Job> {
  return jsonFetch<Job>(`/jobs/${encodeURIComponent(id)}`);
}

export function startAnalyze(input: { file?: File; url?: string; frameworkName?: string }): Promise<Job> {
  const form = new FormData();
  if (input.file) form.append("file", input.file);
  if (input.url) form.append("url", input.url);
  if (input.frameworkName) form.append("framework_name", input.frameworkName);
  return fetch(`${API_ROOT}/analyze`, { method: "POST", body: form }).then(async (response) => {
    if (!response.ok) throw new Error((await response.text()).slice(0, 400) || "Analyze failed");
    return (await response.json()) as Job;
  });
}

export function startProduce(input: {
  plan: RenderPlan;
  clips: File[];
  clipUrls?: string[];
  bgAudio?: File | null;
  sfxAudio?: File | null;
  options?: Partial<ProduceOptions>;
}): Promise<Job> {
  const form = new FormData();
  form.append("plan", JSON.stringify(input.plan));
  input.clips.forEach((clip) => form.append("clips", clip, clip.name));
  if (input.clipUrls?.length) form.append("clip_urls", JSON.stringify(input.clipUrls));
  if (input.bgAudio) form.append("bg_audio", input.bgAudio, input.bgAudio.name);
  if (input.sfxAudio) form.append("sfx_audio", input.sfxAudio, input.sfxAudio.name);
  form.append("options", JSON.stringify(input.options ?? {}));
  return fetch(`${API_ROOT}/produce`, { method: "POST", body: form }).then(async (response) => {
    if (!response.ok) throw new Error((await response.text()).slice(0, 400) || "Produce failed");
    return (await response.json()) as Job;
  });
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onUpdate?: (job: Job) => void;
}

export async function pollJob(id: string, options: PollOptions = {}): Promise<Job> {
  const interval = options.intervalMs ?? 700;
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60 * 1000);
  for (;;) {
    if (options.signal?.aborted) throw new Error("Cancelled");
    const job = await getJob(id);
    options.onUpdate?.(job);
    if (job.status === "done") return job;
    if (job.status === "error") throw new Error(job.error || "Job failed");
    if (Date.now() > deadline) throw new Error("Job timed out");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export function fileUrl(path: string): string {
  if (/^https?:|^blob:|^data:/.test(path)) return path;
  return path.startsWith("/api/") ? path : `${API_ROOT}${path.startsWith("/") ? "" : "/"}${path}`;
}
