"use client";

import clsx from "clsx";
import {
  Activity,
  AudioWaveform,
  Clapperboard,
  Cpu,
  Film,
  ScanLine,
  ShieldCheck,
  Vault,
} from "lucide-react";
import { ReactNode } from "react";
import { useStudio, engineLabel } from "@/lib/store";
import { Badge } from "./ui";

const NAV = [
  { key: "extractor", label: "Framework Extractor", sub: "Observation lab", icon: ScanLine, shortcut: "1" },
  { key: "produce", label: "Production House", sub: "1-click replication", icon: Clapperboard, shortcut: "2" },
  { key: "vault", label: "Framework Vault", sub: "DNA blueprints", icon: Vault, shortcut: "3" },
] as const;

const TAB_COPY: Record<string, { title: string; blurb: string }> = {
  extractor: {
    title: "Observation Lab",
    blurb: "Deconstruct a reference edit into cut rhythm, stems, grade and retention map.",
  },
  produce: {
    title: "Virtual Production House",
    blurb: "Replicate a saved framework against new footage at any target duration.",
  },
  vault: {
    title: "Framework DNA Vault",
    blurb: "Inspect, export and import portable blueprints. One JSON + stems = a reusable asset.",
  },
};

function CapabilityDots() {
  const { capabilities, engine } = useStudio();
  if (engine !== "server" || !capabilities) return null;
  const items = [
    { label: "ffmpeg", on: capabilities.ffmpeg },
    { label: "demucs", on: capabilities.demucs },
    { label: "opencv", on: capabilities.opencv },
    { label: "yt-dlp", on: capabilities.ytdlp },
    { label: "beats", on: capabilities.librosa },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item.label}
          title={`${item.label}: ${item.on ? "available" : "not installed"}`}
          className={clsx(
            "rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider",
            item.on ? "border-silver/20 bg-silver/10 text-silver" : "border-stroke bg-transparent text-muted/50",
          )}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { tab, setTab, frameworks, engine, capabilities } = useStudio();
  const status = engineLabel(engine, capabilities);
  const copy = TAB_COPY[tab];

  return (
    <div className="relative flex min-h-screen bg-ink">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col border-r border-stroke/80 bg-[#0B0D10] lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-md border border-silver/25 bg-gradient-to-b from-white/[0.09] to-transparent">
            <span className="font-mono text-[11px] font-semibold tracking-[0.02em] text-paper">NF</span>
          </div>
          <div className="leading-tight">
            <div className="font-mono text-[12px] font-semibold tracking-[0.22em] text-paper">NEXUS</div>
            <div className="font-mono text-[12px] tracking-[0.34em] text-muted">FRAME</div>
          </div>
        </div>

        <div className="mx-5 hairline" />
        <nav className="mt-4 flex flex-col gap-0.5 px-2.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={clsx(
                  "focus-ring group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition",
                  active ? "bg-white/[0.055] text-paper shadow-[inset_0_0_0_1px_rgba(201,209,217,0.09)]" : "text-muted hover:bg-white/[0.025] hover:text-silver",
                )}
              >
                <Icon size={16} className={clsx(active ? "text-paper" : "text-muted group-hover:text-silver")} />
                <span className="flex-1">
                  <span className="block text-[12.5px] font-medium leading-tight">{item.label}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-tight text-muted/80">{item.sub}</span>
                </span>
                <span className="font-mono text-[9px] text-muted/50">{item.shortcut}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3 p-4">
          <div className="rounded-lg border border-stroke/80 bg-ink/60 p-3">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Engine</span>
              <Badge tone={status.tone === "ok" ? "ok" : "muted"} className="!px-1.5 !py-[1px] !text-[9px]">
                {engine === "server" ? "node" : engine === "browser" ? "lite" : "…"}
              </Badge>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-silver">
              {engine === "server" ? <Cpu size={12} /> : <Film size={12} />}
              {status.label}
            </div>
            <div className="mt-0.5 text-[10.5px] leading-snug text-muted">{status.detail}</div>
            <div className="mt-2">
              <CapabilityDots />
            </div>
          </div>

          <div className="rounded-lg border border-stroke/80 bg-ink/40 p-3">
            <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
              <ShieldCheck size={11} /> WATERMARK LOCKED
              <span className="ml-auto font-mono text-[9px] text-silver">x24:y24</span>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-muted/80">
              Every render composites the silver mark top-left. Non-negotiable in both render nodes.
            </p>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-stroke/80 bg-ink/85 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 lg:px-8">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="eyebrow">Virtual production house</span>
                <span className="text-muted/40">/</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-silver">{copy.title}</span>
              </div>
              <p className="mt-0.5 hidden truncate text-[11.5px] text-muted sm:block">{copy.blurb}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="neutral" className="hidden sm:inline-flex">
                <AudioWaveform size={11} /> {frameworks.length} frameworks
              </Badge>
              <Badge tone={status.tone === "ok" ? "live" : "muted"}>
                <Activity size={11} className="opacity-70" /> {status.label}
              </Badge>
            </div>
          </div>
          {/* Mobile nav */}
          <div className="flex gap-1 overflow-x-auto border-t border-stroke/60 px-3 py-2 lg:hidden">
            {NAV.map((item) => (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-[11.5px]",
                  tab === item.key ? "bg-white/[0.06] text-paper" : "text-muted",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>

        <footer className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-6 text-[10.5px] text-muted/70 lg:px-8">
          <span className="font-mono uppercase tracking-[0.18em]">Nexus Frame / DNA schema 1.0</span>
          <span className="hidden h-3 w-px bg-stroke sm:block" />
          <span>Beat-elastic scaling · 5-pillar retention · sidechain ducking · −14 LUFS</span>
          <span className="ml-auto font-mono">top-left watermark enforced</span>
        </footer>
      </div>
    </div>
  );
}
