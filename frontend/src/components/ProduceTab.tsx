"use client";

import clsx from "clsx";
import {
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  Cpu,
  Download,
  FileVideo,
  Film,
  Gauge,
  Layers,
  Link2,
  Loader2,
  Music4,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api";
import { synthesizePreviewBed } from "@/lib/demoAudio";
import { BrowserProducer } from "@/lib/renderEngine";
import { formatClock, formatDuration, parseTargetDuration, scaleFramework } from "@/lib/scaler";
import { useStudio } from "@/lib/store";
import { FrameworkDna, PILLAR_META } from "@/lib/types";
import { TimelineView } from "./TimelineView";
import { Badge, Button, Checkbox, EmptyState, Field, Panel, PanelHead, Progress, Segmented, Stat, formatBytes } from "./ui";

interface RenderResult {
  url: string | null;
  poster?: string;
  duration: number;
  width: number;
  height: number;
  engine: "ffmpeg" | "browser";
  bytes?: number;
  frames?: number;
  poster_from_node?: string;
}

const PRESETS = ["15s", "30s", "45s", "60s", "90s", "02:00"];

function DnaStrip({ dna }: { dna: FrameworkDna }) {
  const shots = dna.shots.slice(0, 44);
  const max = Math.max(...shots.map((s) => s.duration), 0.4);
  return (
    <div className="flex h-6 items-end gap-[2px]">
      {shots.map((shot) => (
        <span
          key={shot.index}
          className="flex-1 rounded-[1px] bg-silver/50"
          style={{ height: `${Math.max(14, (shot.duration / max) * 100)}%`, opacity: 0.35 + shot.motion_energy * 0.6 }}
        />
      ))}
    </div>
  );
}

function FrameworkCard({
  dna,
  active,
  onSelect,
}: {
  dna: FrameworkDna;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={clsx(
        "focus-ring group w-full rounded-lg border p-3 text-left transition",
        active
          ? "border-silver/40 bg-silver/[0.07] shadow-[inset_0_0_0_1px_rgba(230,237,243,0.16)]"
          : "border-stroke bg-ink/40 hover:border-silver/25 hover:bg-white/[0.02]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={clsx("truncate text-[12.5px] font-medium", active ? "text-paper" : "text-silver")}>{dna.framework_name}</div>
          <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-wider text-muted">
            {formatClock(dna.duration_sec)} · {dna.audio.bpm || "—"} bpm · {dna.shots.length} cuts
          </div>
        </div>
        <span className={clsx("mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[8.5px]", active ? "border-silver/40 text-paper" : "border-stroke text-muted")}>
          {dna.source.aspect}
        </span>
      </div>
      <div className="mt-2">
        <DnaStrip dna={dna} />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex gap-1">
          {dna.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-muted">
              {tag}
            </span>
          ))}
        </div>
        <span className="font-mono text-[8.5px] uppercase tracking-wider text-muted/70">{dna.audio.stems.bgm ? "stem ready" : "preview bed"}</span>
      </div>
    </button>
  );
}

export function ProduceTab() {
  const { capabilities, frameworks, selectedId, setSelected, engine, draft, referenceAudio, toast } = useStudio();
  const framework = frameworks.find((f) => f.id === selectedId) ?? frameworks[0] ?? null;

  const [clips, setClips] = useState<File[]>([]);
  const [clipUrls, setClipUrls] = useState("");
  const [durationInput, setDurationInput] = useState("30");
  const [bgMode, setBgMode] = useState<"framework" | "custom">("framework");
  const [customBg, setCustomBg] = useState<File | null>(null);
  const [preserveSfx, setPreserveSfx] = useState(true);
  const [trimSilence, setTrimSilence] = useState(true);
  const [renderEngine, setRenderEngine] = useState<"server" | "browser">(engine === "server" ? "server" : "browser");
  const [producing, setProducing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusLine, setStatusLine] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const [usedDemoBed, setUsedDemoBed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const producerRef = useRef<BrowserProducer | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    setRenderEngine(engine === "server" ? "server" : "browser");
  }, [engine]);

  const target = parseTargetDuration(durationInput);
  const clampWarning =
    target === null ? "Enter seconds (45) or clock time (01:30)." : target < 2 ? "Minimum production length is 2s." : target > 1800 ? "Maximum production length is 30 minutes." : null;
  const effectiveTarget = target === null ? 30 : Math.max(2, Math.min(1800, target));

  const plan = useMemo(
    () =>
      framework
        ? scaleFramework(framework, {
            target_duration_sec: effectiveTarget,
            bg_mode: bgMode,
            preserve_sfx: preserveSfx,
          })
        : null,
    [framework, effectiveTarget, bgMode, preserveSfx],
  );

  const urls = clipUrls
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const frameworkAudioAvailable = Boolean(
    framework?.audio.stems.bgm || (draft && framework?.id === draft.id && referenceAudio),
  );

  const addClips = (incoming: FileList | File[] | null) => {
    if (!incoming) return;
    const list = Array.from(incoming as FileList).filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name),
    );
    if (!list.length) {
      setError("Those files are not decodable video clips.");
      return;
    }
    setError(null);
    setClips((prev) => [...prev, ...list].slice(0, 12));
  };

  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-100), `${new Date().toLocaleTimeString([], { hour12: false })}  ${line}`]);
  }, []);

  const resolveAudioFile = async (): Promise<File | null> => {
    if (bgMode === "custom") return customBg;
    if (!framework) return null;
    if (draft && framework.id === draft.id && referenceAudio) {
      setUsedDemoBed(false);
      return referenceAudio;
    }
    const stemUrl = framework.audio.stems.bgm;
    if (stemUrl) {
      try {
        const response = await fetch(api.fileUrl(stemUrl));
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        setUsedDemoBed(false);
        return new File([blob], `${framework.id}-bgm.wav`, { type: blob.type || "audio/wav" });
      } catch {
        pushLog("Framework BGM stem unreachable — synthesising a preview bed");
      }
    }
    // No isolated stem: keep the render audible with a license-free pulse bed.
    const bed = synthesizePreviewBed(plan?.bpm ?? framework.audio.bpm ?? 120, 8, framework.grade.saturation < 0.85 ? "dark" : "bright");
    setUsedDemoBed(true);
    return bed.file;
  };

  const produce = async () => {
    if (!framework || !plan) {
      toast("error", "Select a framework first.");
      return;
    }
    if (!clips.length && !urls.length) {
      setError("Add raw footage — local clips or, with the production node online, clip URLs.");
      return;
    }
    if (clampWarning) {
      setError(clampWarning);
      return;
    }
    if (renderEngine === "browser" && !clips.length) {
      setError("Studio Lite renders local clips only. Add files, or switch to the production node for URLs.");
      return;
    }

    setError(null);
    setProducing(true);
    setProgress(0);
    setResult(null);
    setLogs([]);
    cancelledRef.current = false;
    pushLog(`Compiling ${formatDuration(plan.target_duration_sec)} from ${plan.slots.length} slots (${plan.framework_name})`);

    try {
      const audioFile = await resolveAudioFile();
      if (audioFile) pushLog(`BGM attached · ${audioFile.name} · ${formatBytes(audioFile.size)}`);
      else pushLog("No BGM attached — rendering silent");

      if (renderEngine === "server") {
        pushLog("Handing plan to the FFmpeg production node…");
        const job = await api.startProduce({
          plan,
          clips,
          clipUrls: urls,
          bgAudio: audioFile,
          options: {
            target_duration_sec: effectiveTarget,
            bg_mode: bgMode,
            preserve_sfx: preserveSfx,
            trim_silence: trimSilence,
          },
        });
        const done = await api.pollJob(job.id, {
          onUpdate: (update) => {
            setProgress(update.progress);
            const running = update.steps.find((s) => s.status === "running");
            if (running) setStatusLine(`${running.label} · ${Math.round(running.progress * 100)}%`);
            if (update.logs?.length) {
              setLogs((prev) => {
                const seen = new Set(prev.map((line) => line.slice(11)));
                const fresh = update.logs.filter((line) => !seen.has(line));
                return fresh.length
                  ? [...prev, ...fresh.map((line) => `${new Date().toLocaleTimeString([], { hour12: false })}  ${line}`)].slice(-120)
                  : prev;
              });
            }
          },
        });
        if (cancelledRef.current) return;
        const payload = done.result as {
          video_url: string;
          poster_url?: string;
          width: number;
          height: number;
          duration_sec: number;
          bytes?: number;
          plan?: typeof plan;
        };
        setResult({
          url: api.fileUrl(payload.video_url),
          poster: payload.poster_url ? api.fileUrl(payload.poster_url) : undefined,
          duration: payload.duration_sec ?? effectiveTarget,
          width: payload.width ?? 1080,
          height: payload.height ?? 1920,
          engine: "ffmpeg",
          bytes: payload.bytes,
        });
        setProgress(1);
        setStatusLine("Render complete");
        pushLog("FFmpeg render complete · watermark composited top-left");
        toast("ok", `Produced ${formatDuration(effectiveTarget)} on the production node.`);
      } else {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Render surface unavailable");
        pushLog(`Studio Lite capture · ${plan.slots.length} cuts · realtime ${formatDuration(effectiveTarget)}`);
        const producer = new BrowserProducer({
          plan,
          sources: clips.map((file) => ({ file, name: file.name })),
          canvas,
          bgAudio: audioFile,
          onProgress: (value, label) => {
            setProgress(value);
            setStatusLine(label);
          },
        });
        producerRef.current = producer;
        const rendered = await producer.run();
        producerRef.current = null;
        if (cancelledRef.current) return;
        setResult({
          url: rendered.url,
          poster: rendered.posterDataUrl,
          duration: rendered.durationSec,
          width: rendered.width,
          height: rendered.height,
          engine: "browser",
          bytes: rendered.blob?.size,
          frames: rendered.framesDrawn,
        });
        setProgress(1);
        setStatusLine("Capture complete");
        pushLog(`WebM captured · ${rendered.framesDrawn} frames · ${formatBytes(rendered.blob?.size ?? 0)}`);
        toast("ok", "Timeline rendered with the locked top-left watermark.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Render failed";
      if (!/cancel/i.test(message)) {
        setError(message);
        pushLog(`ERROR ${message}`);
      }
    } finally {
      setProducing(false);
      producerRef.current = null;
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    producerRef.current?.dispose();
    producerRef.current = null;
    setProducing(false);
    setStatusLine("Cancelled");
    pushLog("Render cancelled by operator");
  };

  if (!frameworks.length) {
    return (
      <Panel>
        <EmptyState
          icon={<Clapperboard size={26} />}
          title="The vault is empty"
          body="Observe a reference video in the Framework Extractor, name the blueprint, then return here to replicate it against new footage."
          action={
            <Button variant="primary" size="sm" onClick={() => useStudio.getState().setTab("extractor")} icon={<ArrowRight size={13} />}>
              Open extractor
            </Button>
          }
        />
      </Panel>
    );
  }

  const slotTimeline = (plan?.slots ?? []).map((slot) => ({
    start: slot.start,
    end: slot.end,
    pillar: slot.pillar,
    motion: slot.motion,
    transition: slot.transition,
    motion_energy: Math.min(1, 0.3 + slot.duration / 2),
    duration: slot.duration,
    index: slot.index,
    sfx: slot.sfx.length,
  }));

  const downloadName = `${(framework?.framework_name ?? "framework").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.round(effectiveTarget)}s.${result?.engine === "ffmpeg" ? "mp4" : "webm"}`;

  return (
    <div className="grid gap-5 xl:grid-cols-[1.02fr_1fr]">
      {/* LEFT COLUMN */}
      <div className="space-y-5">
        <Panel>
          <PanelHead
            eyebrow="Production vault"
            title="Select framework DNA"
            icon={<Layers size={15} />}
            actions={<Badge tone="muted">{frameworks.length} owned</Badge>}
          />
          <div className="max-h-[260px] space-y-2 overflow-y-auto p-3.5">
            {frameworks.map((dna) => (
              <FrameworkCard key={dna.id} dna={dna} active={dna.id === framework?.id} onSelect={() => setSelected(dna.id)} />
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHead
            eyebrow="Raw material"
            title="New footage"
            icon={<FileVideo size={15} />}
            actions={<Badge tone="muted">{clips.length} clip{clips.length === 1 ? "" : "s"}</Badge>}
          />
          <div className="space-y-3.5 p-4">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addClips(event.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={clsx(
                "cursor-pointer rounded-lg border border-dashed px-4 py-5 text-center transition",
                dragging ? "border-silver/60 bg-silver/[0.06]" : "border-stroke bg-ink/40 hover:border-silver/30",
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(event) => addClips(event.target.files)}
              />
              <Upload size={15} className="mx-auto mb-1.5 text-muted" />
              <div className="text-[12px] text-silver">Drop raw clips</div>
              <div className="mt-0.5 text-[10.5px] text-muted">Multi-select allowed · sharpest segments win their slot</div>
            </div>

            {clips.length ? (
              <div className="space-y-1.5">
                {clips.map((clip, index) => (
                  <div key={`${clip.name}-${index}`} className="flex items-center gap-2 rounded-md border border-stroke/70 bg-ink/40 px-2.5 py-1.5">
                    <Film size={12} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-silver">{clip.name}</span>
                    <span className="font-mono text-[9.5px] text-muted">{formatBytes(clip.size)}</span>
                    <button
                      className="text-muted hover:text-paper"
                      onClick={() => setClips((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={`Remove ${clip.name}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <Field
              label="Clip URLs"
              hint={
                engine === "server"
                  ? `One per line · fetched by yt-dlp${capabilities?.ytdlp_version ? ` ${capabilities.ytdlp_version}` : ""} on the node. If the node's network is filtered, upload the files instead.`
                  : "Requires the production node. Studio Lite uses local files."
              }
            >
              <div className="relative">
                <Link2 size={13} className="pointer-events-none absolute left-3 top-3 text-muted" />
                <textarea
                  value={clipUrls}
                  onChange={(event) => setClipUrls(event.target.value)}
                  disabled={engine !== "server"}
                  rows={2}
                  placeholder={"https://…/raw-clip-1.mp4\nhttps://…/raw-clip-2.mp4"}
                  className="input resize-none pl-8 font-mono text-[11px]"
                />
              </div>
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHead
            eyebrow="Compiler"
            title="Duration & audio"
            icon={<Gauge size={15} />}
            actions={<Badge tone="neutral">{plan?.stats.cuts ?? 0} slots</Badge>}
          />
          <div className="space-y-4 p-4">
            <div>
              <div className="flex items-end justify-between gap-2">
                <span className="eyebrow">Target output duration</span>
                <span className="font-mono text-[10px] text-muted">
                  {target ? `= ${formatClock(target)}` : "invalid"}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  value={durationInput}
                  onChange={(event) => setDurationInput(event.target.value)}
                  placeholder="30 or 01:30"
                  className="input font-mono text-[15px]"
                  inputMode="text"
                />
                <div className="flex shrink-0 gap-1">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setDurationInput(preset)}
                      className={clsx(
                        "focus-ring rounded-md border px-2 py-1.5 font-mono text-[10px] transition",
                        durationInput === preset ? "border-silver/40 bg-silver/15 text-paper" : "border-stroke text-muted hover:text-silver",
                      )}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
              {clampWarning ? <div className="mt-1 text-[10.5px] text-amber-400/90">{clampWarning}</div> : null}
            </div>

            {plan ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Cuts" value={plan.stats.cuts} />
                <Stat label="Avg shot" value={`${plan.stats.avg_clip_duration.toFixed(2)}s`} />
                <Stat label="Beat snaps" value={plan.stats.snapped_cuts} hint={`±40 ms window`} />
                <Stat label="BGM loops" value={plan.stats.loop_count} />
              </div>
            ) : null}

            <div className="space-y-2.5 rounded-lg border border-stroke/70 bg-ink/40 p-3">
              <div className="flex items-center justify-between">
                <span className="eyebrow flex items-center gap-1.5">
                  <Music4 size={11} /> Background audio
                </span>
                <Segmented
                  size="sm"
                  value={bgMode}
                  onChange={(value) => setBgMode(value)}
                  options={[
                    { value: "framework", label: "Framework BG" },
                    { value: "custom", label: "Custom" },
                  ]}
                />
              </div>
              {bgMode === "framework" ? (
                <div className="text-[10.5px] leading-snug text-muted">
                  {frameworkAudioAvailable
                    ? "Using the isolated framework BGM, looped with crossfades on beat boundaries."
                    : "No isolated stem on this framework — a licence-free preview bed is synthesised at the framework BPM."}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(event) => setCustomBg(event.target.files?.[0] ?? null)}
                  />
                  <Button size="sm" variant="silver" icon={<Music4 size={12} />} onClick={() => audioInputRef.current?.click()}>
                    {customBg ? "Replace audio" : "Upload BGM"}
                  </Button>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted">
                    {customBg ? `${customBg.name} · ${formatBytes(customBg.size)}` : "wav / mp3 / m4a"}
                  </span>
                </div>
              )}
              <Checkbox
                checked={preserveSfx}
                onChange={setPreserveSfx}
                label="Preserve framework transition SFX"
                hint="Whooshes, risers and hits stay glued to the cut behaviour even when the BGM changes."
              />
              <Checkbox
                checked={trimSilence}
                onChange={setTrimSilence}
                label="Trim dead air from raw clips (VAD)"
                hint="The node scans each upload for silence and only cuts from speech-bearing stretches."
              />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-md border border-stroke/70 bg-ink/40 px-3 py-2">
              <span className="flex items-center gap-1.5 text-[10.5px] text-muted">
                <ShieldCheck size={11} className="text-silver" /> Watermark locked · top-left 24:24
              </span>
              <Segmented
                size="sm"
                value={renderEngine}
                onChange={setRenderEngine}
                options={[
                  { value: "server", label: "Production node", disabled: engine !== "server", hint: engine !== "server" ? "Python node offline" : "FFmpeg · full render" },
                  { value: "browser", label: "Studio Lite", hint: "In-browser WebM capture" },
                ]}
              />
            </div>

            {producing ? (
              <Button variant="ghost" size="lg" className="w-full" icon={<Square size={12} />} onClick={cancel}>
                Stop render
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                icon={<Play size={15} />}
                onClick={() => void produce()}
                disabled={!plan || Boolean(clampWarning)}
              >
                Produce video · {formatDuration(effectiveTarget)}
              </Button>
            )}
            <div className="flex items-center justify-between text-[10px] text-muted">
              <span className="flex items-center gap-1">
                {renderEngine === "server" ? <Cpu size={10} /> : <Wand2 size={10} />}
                {renderEngine === "server" ? "Hardware-accelerated FFmpeg filtergraph" : "Realtime canvas capture (duration = render time)"}
              </span>
              <span className="font-mono">{plan?.bpm || 0} BPM target</span>
            </div>
            {usedDemoBed ? (
              <div className="rounded-md border border-amber-900/50 bg-amber-950/20 px-2.5 py-1.5 text-[10px] leading-snug text-amber-300/90">
                Preview bed in use — drop a custom BGM or attach the framework stem for a client-grade mix.
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      {/* RIGHT COLUMN — STAGE */}
      <div className="space-y-5">
        <Panel className="overflow-hidden">
          <PanelHead
            eyebrow="Render stage"
            title={result ? "Output · watermarked" : producing ? "Capturing timeline" : "Preview monitor"}
            icon={<Clapperboard size={15} />}
            actions={
              <>
                <Badge tone={producing ? "live" : result ? "ok" : "muted"}>
                  {producing ? "recording" : result ? "ready" : "standby"}
                </Badge>
                <Badge tone="muted">{plan?.aspect ?? framework?.source.aspect ?? "9:16"}</Badge>
              </>
            }
          />
          <div className="p-4">
            <div
              className={clsx(
                "relative mx-auto overflow-hidden rounded-lg border border-stroke bg-black",
                (plan?.aspect ?? "9:16") === "16:9" ? "aspect-video w-full" : "aspect-[9/16] w-full max-w-[300px]",
              )}
            >
              <canvas ref={canvasRef} className={clsx("h-full w-full object-contain", result ? "hidden" : "block")} />
              {result?.url ? (
                <video
                  key={result.url}
                  src={result.url}
                  poster={result.poster}
                  controls
                  loop
                  playsInline
                  className="h-full w-full bg-black object-contain"
                />
              ) : null}

              {!result && !producing ? (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#080A0C]/80 px-4 text-center grid-stage">
                  <Clapperboard size={22} className="text-muted/60" />
                  <div className="text-[11.5px] text-silver">Stage is empty</div>
                  <div className="text-[10px] leading-snug text-muted">
                    Pick a framework, add footage, set the duration and press produce.
                  </div>
                </div>
              ) : null}

              {producing ? (
                <div className="absolute inset-x-0 bottom-0 space-y-1.5 bg-gradient-to-t from-black/90 to-transparent px-3 pb-3 pt-8">
                  <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-silver">
                    <span className="flex items-center gap-1.5">
                      <span className="dot-live h-1.5 w-1.5 rounded-full bg-red-500" /> rec
                    </span>
                    <span>{Math.round(progress * 100)}%</span>
                  </div>
                  <Progress value={progress} />
                  <div className="truncate font-mono text-[9px] text-muted">{statusLine}</div>
                </div>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Length" value={formatDuration(result?.duration ?? effectiveTarget)} />
              <Stat label="Frame" value={result ? `${result.width}×${result.height}` : "—"} />
              <Stat label="Engine" value={result ? (result.engine === "ffmpeg" ? "ffmpeg" : "canvas") : renderEngine === "server" ? "ffmpeg" : "canvas"} />
              <Stat label="Size" value={result?.bytes ? formatBytes(result.bytes) : "—"} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {result?.url ? (
                <a
                  href={result.url}
                  download={downloadName}
                  className="btn btn-primary flex-1 focus-ring"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={14} /> Download {result.engine === "ffmpeg" ? "MP4" : "WebM"}
                </a>
              ) : null}
              <Button
                variant="ghost"
                icon={<RefreshCw size={13} />}
                onClick={() => void produce()}
                disabled={producing || !plan}
                className={result?.url ? "" : "flex-1"}
              >
                {result ? "Re-render" : "Render"}
              </Button>
              <Button
                variant="ghost"
                icon={<Layers size={13} />}
                onClick={() => useStudio.getState().setTab("vault")}
              >
                Vault
              </Button>
            </div>

            {error ? (
              <p className="mt-3 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-[11px] leading-snug text-red-300">{error}</p>
            ) : null}
          </div>
        </Panel>

        {plan ? (
          <Panel>
            <PanelHead
              eyebrow="Compiled timeline"
              title={`${plan.stats.cuts} slots · ${plan.stats.effective_bpm.toFixed(1)} effective BPM`}
              icon={<Gauge size={15} />}
              actions={
                <>
                  <Badge tone="neutral">{Math.round(plan.stats.density * 100) / 100}/s density</Badge>
                  <Badge tone="ok">{plan.stats.snapped_cuts} beat-locked</Badge>
                </>
              }
            />
            <div className="p-4">
              <TimelineView duration={plan.target_duration_sec} shots={slotTimeline} beats={plan.beat_grid} plan={plan} height={124} />
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {plan.pillars.map((block) => (
                  <div key={block.pillar} className="rounded-md border border-stroke/70 bg-ink/40 px-2.5 py-2">
                    <div className="eyebrow truncate">{PILLAR_META[block.pillar].short}</div>
                    <div className="font-mono text-[11px] text-paper">{block.shot_count} cuts</div>
                    <div className="font-mono text-[9.5px] text-muted">
                      {block.start.toFixed(1)}–{block.end.toFixed(1)}s
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        ) : null}

        <Panel>
          <PanelHead
            eyebrow="Node log"
            title="Render telemetry"
            icon={<Loader2 size={15} className={clsx(producing && "animate-spin")} />}
            actions={<span className="font-mono text-[9px] text-muted">{logs.length} lines</span>}
          />
          <div className="max-h-[188px] min-h-[110px] overflow-y-auto bg-[#080A0C] p-3 font-mono text-[10px] leading-relaxed text-muted">
            {logs.length ? (
              logs.map((line, index) => (
                <div key={index} className={clsx("break-words", /ERROR/.test(line) && "text-red-400", /complete|locked/i.test(line) && "text-silver")}>
                  {line}
                </div>
              ))
            ) : (
              <div className="text-muted/50">awaiting production…</div>
            )}
          </div>
        </Panel>

        <div className="flex items-center gap-2 rounded-lg border border-stroke/70 bg-ink/30 px-3 py-2.5 text-[10.5px] text-muted">
          <CheckCircle2 size={13} className="shrink-0 text-silver/70" />
          <span>
            Rhythm is preserved, not stretched: density stays constant and every cut snaps to the nearest beat. Only the slot count changes.
          </span>
        </div>
      </div>
    </div>
  );
}
