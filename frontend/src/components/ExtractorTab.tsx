"use client";

import clsx from "clsx";
import {
  AudioWaveform,
  Clapperboard,
  FileVideo,
  Film,
  Layers,
  Link2,
  Lock,
  Music4,
  Play,
  RotateCcw,
  ScanLine,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api";
import { AnalyzeProgress, analyzeVideoFile } from "@/lib/analyzer";
import { formatDuration } from "@/lib/scaler";
import { useStudio } from "@/lib/store";
import { FrameworkDna, Job, JobStep, PILLAR_META, PILLAR_ORDER } from "@/lib/types";
import { SaveFrameworkModal } from "./SaveFrameworkModal";
import { TimelineView } from "./TimelineView";
import { Badge, Button, EmptyState, Field, Panel, PanelHead, Progress, Stat, formatBytes } from "./ui";

interface StepState {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  detail?: string;
  icon: typeof Film;
}

const BASE_STEPS: StepState[] = [
  { key: "probe", label: "Ingest & probe", status: "pending", progress: 0, icon: Film },
  { key: "frames", label: "Scene cuts · motion · grade", status: "pending", progress: 0, icon: ScanLine },
  { key: "audio", label: "Audio fingerprint · beat grid", status: "pending", progress: 0, icon: AudioWaveform },
  { key: "build", label: "Five-pillar retention map", status: "pending", progress: 0, icon: Layers },
];

function mapServerSteps(steps: JobStep[]): StepState[] {
  return steps.map((step, index) => ({
    key: step.key,
    label: step.label,
    status: step.status === "skipped" ? "done" : step.status,
    progress: step.status === "done" || step.status === "skipped" ? 1 : step.progress,
    detail: step.detail,
    icon: BASE_STEPS[index]?.icon ?? Sparkles,
  }));
}

export function ExtractorTab() {
  const { engine, capabilities, draft, setDraft, frameworks, saveDraft, setReferenceAudio, toast } = useStudio();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [steps, setSteps] = useState<StepState[]>(BASE_STEPS);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<number[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const sample = frameworks[0] ?? null;
  const display = draft ?? sample;

  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-60), `${new Date().toLocaleTimeString([], { hour12: false })}  ${line}`]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSteps(BASE_STEPS);
    setLogs([]);
    setProgress(0);
    setError(null);
    setRunning(false);
    setEnvelope(null);
  };

  const acceptFile = (incoming: File | null) => {
    if (!incoming) return;
    if (!incoming.type.startsWith("video/") && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(incoming.name)) {
      setError("That file is not a video the browser can decode. Try MP4 / MOV / WebM.");
      return;
    }
    setFile(incoming);
    setError(null);
    reset();
    setSteps(BASE_STEPS);
  };

  const applyBrowserProgress = (event: AnalyzeProgress) => {
    setProgress(event.progress);
    setSteps((prev) =>
      prev.map((step, index) => {
        const target = BASE_STEPS.findIndex((s) => s.key === event.step);
        if (event.step === "done") return { ...step, status: "done", progress: 1 };
        if (index < target) return { ...step, status: "done", progress: 1 };
        if (index === target) return { ...step, status: "running", progress: event.progress, detail: event.detail };
        return { ...step, status: "pending", progress: 0 };
      }),
    );
    if (event.detail) pushLog(event.detail);
  };

  const runBrowser = async (source: File) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const dna = await analyzeVideoFile(source, {
      sourceLabel: source.name,
      frameworkName: source.name.replace(/\.[^.]+$/, ""),
      onProgress: applyBrowserProgress,
      onEnvelope: (env) => setEnvelope(env),
      signal: controller.signal,
    });
    setDraft(dna);
    setReferenceAudio(source, source);
    setSteps((prev) => prev.map((s) => ({ ...s, status: "done", progress: 1 })));
    setProgress(1);
    pushLog(`Framework DNA compiled · ${dna.shots.length} shots · ${dna.audio.bpm} BPM`);
    toast("ok", `Observation complete — ${dna.shots.length} shots, ${dna.audio.bpm} BPM.`);
  };

  const runServer = async (source: File) => {
    const job = await api.startAnalyze({ file: source, frameworkName: source.name.replace(/\.[^.]+$/, "") });
    pushLog(`Production node accepted job ${job.id}`);
    let lastSteps: JobStep[] = [];
    const done = await api.pollJob(job.id, {
      onUpdate: (update: Job) => {
        setProgress(update.progress);
        if (update.steps?.length) {
          const mapped = mapServerSteps(update.steps);
          setSteps(mapped);
          const changed = update.steps.filter((s) => {
            const previous = lastSteps.find((p) => p.key === s.key);
            return s.status !== previous?.status && s.detail;
          });
          changed.forEach((s) => pushLog(`${s.label}${s.detail ? ` — ${s.detail}` : ""}`));
          lastSteps = update.steps;
        }
        if (update.logs?.length) {
          setLogs((prev) => {
            const known = new Set(prev.map((line) => line.slice(11)));
            const fresh = update.logs.filter((line) => !known.has(line)).slice(-12);
            return fresh.length ? [...prev, ...fresh.map((line) => `${new Date().toLocaleTimeString([], { hour12: false })}  ${line}`)].slice(-80) : prev;
          });
        }
      },
    });
    const payload = done.result as { framework?: FrameworkDna; stems?: Record<string, string> } | FrameworkDna;
    const framework = (payload as { framework?: FrameworkDna }).framework ?? (payload as FrameworkDna);
    if (!framework || !framework.shots) throw new Error("The production node returned no framework DNA.");
    setDraft(framework);
    setEnvelope(null);
    setProgress(1);
    pushLog(`Stems + DNA ready · ${framework.shots.length} shots · ${framework.audio.bpm} BPM`);
    toast("ok", "Reference deconstructed on the production node.");

    const stems = (payload as { stems?: Record<string, string> }).stems;
    const bgmUrl = stems?.bgm ?? framework.audio.stems.bgm;
    if (bgmUrl) {
      try {
        const response = await fetch(api.fileUrl(bgmUrl));
        const blob = await response.blob();
        setReferenceAudio(new File([blob], `${framework.id}-bgm.wav`, { type: blob.type || "audio/wav" }), source);
      } catch {
        pushLog("BGM stem could not be attached to the browser deck");
      }
    }
  };

  const analyze = async () => {
    if (running) return;
    reset();
    setError(null);

    const useUrl = !file && url.trim().length > 0;
    if (!file && !useUrl) {
      setError("Drop a reference video or paste a URL first.");
      return;
    }
    if (useUrl && engine !== "server") {
      setError("URL ingestion needs the production node (yt-dlp). Drop a local file to use Studio Lite.");
      return;
    }

    setRunning(true);
    setProgress(0.01);
    setSteps(BASE_STEPS.map((s, i) => ({ ...s, status: i === 0 ? "running" : "pending" })));
    pushLog(useUrl ? `Requesting remote stream · ${url.trim()}` : `Ingesting ${file!.name} · ${formatBytes(file!.size)}`);

    try {
      if (useUrl) {
        const job = await api.startAnalyze({ url: url.trim() });
        pushLog(`Production node accepted job ${job.id}`);
        const done = await api.pollJob(job.id, {
          onUpdate: (update: Job) => {
            setProgress(update.progress);
            if (update.steps?.length) setSteps(mapServerSteps(update.steps));
            if (update.logs?.length) {
              setLogs((prev) => [...prev, ...update.logs.slice(-4).map((line) => `${new Date().toLocaleTimeString([], { hour12: false })}  ${line}`)].slice(-80));
            }
          },
        });
        const payload = done.result as { framework?: FrameworkDna } | FrameworkDna;
        const framework = (payload as { framework?: FrameworkDna }).framework ?? (payload as FrameworkDna);
        if (!framework?.shots) throw new Error("No framework returned");
        setDraft(framework);
        setProgress(1);
        setSteps((prev) => prev.map((s) => ({ ...s, status: "done", progress: 1 })));
        toast("ok", `Remote reference deconstructed · ${framework.shots.length} shots.`);
      } else if (engine === "server") {
        try {
          await runServer(file!);
        } catch (err) {
          pushLog(`Production node failed (${err instanceof Error ? err.message : "unknown"}). Falling back to Studio Lite…`);
          setSteps(BASE_STEPS);
          await runBrowser(file!);
        }
      } else {
        await runBrowser(file!);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      if (!/abort/i.test(message)) {
        setError(message);
        pushLog(`ERROR ${message}`);
        setSteps((prev) => prev.map((s) => (s.status === "running" ? { ...s, status: "error" } : s)));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setRunning(false);
    pushLog("Analysis cancelled by operator");
    setSteps((prev) => prev.map((s) => (s.status === "running" ? { ...s, status: "pending", progress: 0 } : s)));
  };

  const dna = display;
  const shotTimeline = useMemo(
    () =>
      (dna?.shots ?? []).map((shot) => ({
        start: shot.start,
        end: shot.end,
        pillar: shot.pillar,
        motion: shot.motion,
        transition: shot.transition,
        motion_energy: shot.motion_energy,
        duration: shot.duration,
        index: shot.index,
        sfx: undefined,
      })),
    [dna],
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        {/* Ingest */}
        <Panel>
          <PanelHead
            eyebrow="Step 01 · ingest"
            title="Reference material"
            icon={<Upload size={15} />}
            actions={<Badge tone="muted">{engine === "server" ? "yt-dlp + ffprobe" : "local file only"}</Badge>}
          />
          <div className="space-y-4 p-5">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                acceptFile(event.dataTransfer.files?.[0] ?? null);
              }}
              onClick={() => inputRef.current?.click()}
              className={clsx(
                "group relative cursor-pointer rounded-xl border border-dashed px-5 py-7 text-center transition",
                dragging ? "border-silver/60 bg-silver/[0.06]" : "border-stroke bg-ink/40 hover:border-silver/30 hover:bg-white/[0.02]",
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(event) => acceptFile(event.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="flex items-center gap-3 text-left">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-silver/20 bg-silver/10">
                    <FileVideo size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-paper">{file.name}</div>
                    <div className="font-mono text-[10.5px] text-muted">
                      {formatBytes(file.size)} · {file.type || "video"}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost !px-2 !py-1.5"
                    onClick={(event) => {
                      event.stopPropagation();
                      setFile(null);
                      setDraft(null);
                      reset();
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg border border-stroke bg-ink/70 text-silver transition group-hover:border-silver/30">
                    <Upload size={16} />
                  </div>
                  <div className="text-[13px] text-silver">Drop the reference edit</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">MP4 · MOV · WebM — up to a few minutes keeps analysis tight</div>
                  <div className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted/60">or click to browse</div>
                </>
              )}
            </div>

            <div className="relative flex items-center gap-3">
              <div className="hairline" />
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted/60">or</span>
              <div className="hairline" />
            </div>

            <Field
              label="Reference URL"
              hint={
                engine === "server"
                  ? "YouTube · Instagram · TikTok · Facebook — fetched by yt-dlp on the production node."
                  : "Connect the production node to ingest remote URLs; Studio Lite works with local files."
              }
            >
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    disabled={Boolean(file) || engine !== "server"}
                    placeholder="https://youtube.com/watch?v=…"
                    className="input pl-8"
                  />
                </div>
                <Button
                  variant="silver"
                  icon={<ScanLine size={14} />}
                  onClick={() => void analyze()}
                  disabled={!url.trim() || Boolean(file) || engine !== "server"}
                  title={engine !== "server" ? "Requires production node" : "Analyse remote URL"}
                >
                  Fetch
                </Button>
              </div>
            </Field>

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Button
                variant="primary"
                size="lg"
                icon={<Play size={14} />}
                loading={running}
                onClick={() => void analyze()}
                className="flex-1"
              >
                {running ? "Deconstructing…" : "Deconstruct reference"}
              </Button>
              {running ? (
                <Button variant="ghost" size="lg" onClick={cancel}>
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="lg"
                  icon={<RotateCcw size={13} />}
                  onClick={() => {
                    setFile(null);
                    setUrl("");
                    reset();
                  }}
                >
                  Reset
                </Button>
              )}
            </div>

            {error ? (
              <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-[11.5px] leading-snug text-red-300">{error}</p>
            ) : null}

            <div className="rounded-lg border border-stroke/70 bg-ink/40 px-3 py-2 text-[10.5px] leading-relaxed text-muted">
              <span className="text-silver">Engine:</span>{" "}
              {engine === "server"
                ? `production node${capabilities?.demucs ? " · Demucs 3-stem" : " · stems unavailable (Demucs not installed)"}`
                : "Studio Lite (in-browser DSP) · server-side Demucs stems unlock when the Python node is running"}
              . Analysis never uploads footage anywhere else.
            </div>
          </div>
        </Panel>

        {/* Pipeline */}
        <Panel>
          <PanelHead
            eyebrow="Step 02 · pipeline"
            title="Deconstruction telemetry"
            icon={<AudioWaveform size={15} />}
            actions={<Badge tone={running ? "live" : progress >= 1 && dna ? "ok" : "muted"}>{running ? "running" : progress >= 1 ? "complete" : "idle"}</Badge>}
          />
          <div className="flex h-full flex-col p-5">
            <Progress value={progress} indeterminate={running && progress < 0.02} />
            <div className="mt-4 space-y-2.5">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.key} className="flex items-start gap-2.5">
                    <span
                      className={clsx(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                        step.status === "done" && "border-silver/30 bg-silver/15 text-paper",
                        step.status === "running" && "border-silver/40 bg-ink text-silver",
                        step.status === "pending" && "border-stroke bg-ink text-muted/60",
                        step.status === "error" && "border-red-900 bg-red-950/40 text-red-300",
                      )}
                    >
                      {step.status === "running" ? <span className="dot-live h-1.5 w-1.5 rounded-full bg-current" /> : <Icon size={11} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={clsx("text-[12px]", step.status === "pending" ? "text-muted" : "text-silver")}>{step.label}</span>
                        <span className="font-mono text-[9.5px] text-muted/70">{Math.round(step.progress * 100)}%</span>
                      </div>
                      {step.detail ? <div className="mt-0.5 truncate text-[10.5px] text-muted">{step.detail}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="eyebrow">Node log</span>
              <span className="font-mono text-[9px] text-muted/60">{logs.length} lines</span>
            </div>
            <div
              ref={logRef}
              className="mt-1.5 h-[132px] overflow-y-auto rounded-lg border border-stroke/70 bg-[#080A0C] px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted"
            >
              {logs.length ? (
                logs.map((line, i) => (
                  <div key={i} className={clsx("truncate", /ERROR/.test(line) && "text-red-400")}>
                    {line}
                  </div>
                ))
              ) : (
                <div className="text-muted/50">awaiting ingest…</div>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {/* Timeline */}
      <Panel>
        <PanelHead
          eyebrow="Step 03 · observation"
          title={dna ? `${dna.framework_name}` : "Timeline visualiser"}
          icon={<Clapperboard size={15} />}
          actions={
            <>
              {!draft && sample ? <Badge tone="muted">sample · {sample.framework_name}</Badge> : null}
              {draft ? <Badge tone="live">live observation</Badge> : null}
              {dna ? (
                <>
                  <Badge tone="neutral">{formatDuration(dna.duration_sec)}</Badge>
                  <Badge tone="neutral">{dna.audio.bpm} BPM</Badge>
                  <Badge tone="neutral">{dna.shots.length} cuts</Badge>
                </>
              ) : null}
            </>
          }
        />
        <div className="p-5">
          {dna ? (
            <>
              <TimelineView
                duration={dna.duration_sec}
                shots={shotTimeline}
                beats={dna.audio.beat_timestamps}
                envelope={envelope ?? undefined}
                height={148}
              />
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Avg shot" value={`${dna.rhythm.avg_shot_sec.toFixed(2)}s`} />
                <Stat label="Cut density" value={`${dna.rhythm.cut_density.toFixed(2)}/s`} />
                <Stat label="Zoom ratio" value={`${Math.round(dna.stats.zoom_ratio * 100)}%`} hint="shots with push-in" />
                <Stat label="Motion" value={dna.stats.motion_energy.toFixed(2)} hint="mean optical flow" />
                <Stat label="SFX cues" value={dna.sfx_events.length} hint="cut-aligned" />
                <Stat label="Loudness" value={`${dna.audio.lufs ?? "—"} LUFS`} />
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Film size={26} />}
              title="No reference observed yet"
              body="Drop an edit above (or paste a URL with the production node online). NEXUS FRAME extracts the cut ladder, beat grid, grade and transition SFX into a portable blueprint."
              action={
                <Button variant="silver" size="sm" onClick={() => inputRef.current?.click()} icon={<Upload size={13} />}>
                  Select reference
                </Button>
              }
            />
          )}
        </div>
      </Panel>

      {/* DNA inspector + retention */}
      {dna ? (
        <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
          <Panel>
            <PanelHead
              eyebrow="Step 04 · blueprint"
              title="Framework DNA"
              icon={<Layers size={15} />}
              actions={
                <>
                  <Badge tone={dna.audio.preview_only ? "warn" : "ok"}>
                    <Music4 size={10} /> {dna.audio.preview_only ? "stems: reference mix" : "3-stem isolated"}
                  </Badge>
                  <Badge tone="muted">{dna.origin}</Badge>
                </>
              }
            />
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-2">
                {dna.tags.map((tag) => (
                  <span key={tag} className="chip">
                    {tag}
                  </span>
                ))}
                <span className="chip !text-silver">{dna.source.aspect}</span>
                <span className="chip !text-silver">
                  {dna.source.width}×{dna.source.height}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Stat label="Shots" value={dna.stats.cuts} />
                <Stat label="Duration" value={formatDuration(dna.duration_sec)} />
                <Stat label="BPM" value={dna.audio.bpm} hint={`${dna.audio.beat_timestamps.length} beats`} />
                <Stat label="Avg cut" value={`${dna.stats.avg_clip_duration.toFixed(2)}s`} />
              </div>

              <div>
                <div className="eyebrow mb-1.5">Dominant palette</div>
                <div className="flex h-8 overflow-hidden rounded-md border border-stroke/70">
                  {(dna.shots.flatMap((s) => s.palette).slice(0, 6).length ? dna.shots.flatMap((s) => s.palette).slice(0, 6) : ["#0D0F12", "#21262D", "#8B949E"]).map(
                    (color, index) => (
                      <div key={`${color}-${index}`} className="flex-1" style={{ background: color }} title={color} />
                    ),
                  )}
                </div>
              </div>

              <div>
                <div className="eyebrow mb-1.5">Shot ladder · first 12</div>
                <div className="overflow-hidden rounded-lg border border-stroke/70">
                  <table className="w-full text-left font-mono text-[10.5px]">
                    <thead className="bg-ink/60 text-muted">
                      <tr>
                        <th className="px-2.5 py-1.5 font-normal">#</th>
                        <th className="px-2.5 py-1.5 font-normal">in</th>
                        <th className="px-2.5 py-1.5 font-normal">dur</th>
                        <th className="px-2.5 py-1.5 font-normal">motion</th>
                        <th className="px-2.5 py-1.5 font-normal">transition</th>
                        <th className="px-2.5 py-1.5 font-normal">pillar</th>
                      </tr>
                    </thead>
                    <tbody className="text-silver">
                      {dna.shots.slice(0, 12).map((shot) => (
                        <tr key={shot.index} className="border-t border-stroke/50">
                          <td className="px-2.5 py-1 text-muted">{String(shot.index + 1).padStart(2, "0")}</td>
                          <td className="px-2.5 py-1">{shot.start.toFixed(2)}</td>
                          <td className="px-2.5 py-1">{shot.duration.toFixed(2)}s</td>
                          <td className="px-2.5 py-1">{shot.motion}</td>
                          <td className="px-2.5 py-1">{shot.transition}</td>
                          <td className="px-2.5 py-1">{PILLAR_META[shot.pillar].short}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {dna.shots.length > 12 ? <div className="mt-1 text-[10px] text-muted">+ {dna.shots.length - 12} more shots in the blueprint</div> : null}
              </div>
            </div>
          </Panel>

          <div className="space-y-5">
            <Panel>
              <PanelHead eyebrow="Retention architecture" title="Five-pillar map" icon={<Sparkles size={15} />} />
              <div className="space-y-2.5 p-5">
                {PILLAR_ORDER.map((pillar, index) => {
                  const block = dna.pillars.find((p) => p.pillar === pillar);
                  const share = dna.duration_sec ? ((block?.end ?? 0) - (block?.start ?? 0)) / dna.duration_sec : 0;
                  return (
                    <div key={pillar} className="rounded-lg border border-stroke/70 bg-ink/40 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[9px] text-muted">{index + 1}</span>
                          <span className="text-[12px] text-silver">{PILLAR_META[pillar].name}</span>
                        </div>
                        <span className="font-mono text-[10px] text-muted">{Math.round(share * 100)}%</span>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-stroke/60">
                        <div className="h-full rounded-full bg-silver/70" style={{ width: `${Math.max(2, share * 100)}%` }} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted/80">
                        <span>{PILLAR_META[pillar].blurb}</span>
                        <span className="font-mono">{block?.shot_count ?? 0} cuts</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel>
              <PanelHead
                eyebrow="Production vault"
                title={draft ? "Lock this framework" : "Already in the vault"}
                icon={<Lock size={15} />}
              />
              <div className="space-y-3 p-5">
                <p className="text-[11.5px] leading-relaxed text-muted">
                  {draft
                    ? "Name the blueprint to reuse it on any raw footage. The name is mandatory — it is the vault key."
                    : "This framework is saved. Re-open the extractor with new reference material to add another blueprint."}
                </p>
                {draft ? (
                  <Button variant="primary" className="w-full" icon={<Lock size={14} />} onClick={() => setSaveOpen(true)}>
                    Save framework to vault
                  </Button>
                ) : (
                  <Button
                    variant="silver"
                    className="w-full"
                    icon={<Clapperboard size={14} />}
                    onClick={() => useStudio.getState().setTab("produce")}
                  >
                    Open production house
                  </Button>
                )}
                <div className="rounded-md border border-stroke/70 bg-ink/40 px-3 py-2 font-mono text-[9.5px] leading-relaxed text-muted/80">
                  export: {dna.id}.json · {dna.shots.length} shots · {dna.audio.bpm} bpm · {dna.source.aspect}
                </div>
              </div>
            </Panel>
          </div>
        </div>
      ) : null}

      <SaveFrameworkModal
        open={saveOpen}
        dna={draft}
        onClose={() => setSaveOpen(false)}
        onSave={(name, tags, description) => saveDraft(name, tags, description)}
      />
    </div>
  );
}
