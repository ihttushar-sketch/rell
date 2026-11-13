"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { PILLAR_META, PILLAR_ORDER, PillarId, RenderPlan } from "@/lib/types";
import { PILLAR_ACCENT } from "@/lib/store";
import { formatClock } from "@/lib/scaler";

interface TimelineShot {
  start: number;
  end: number;
  pillar: PillarId;
  motion: string;
  transition: string;
  motion_energy?: number;
  duration: number;
  index: number;
  sfx?: number;
}

export function TimelineView({
  duration,
  shots,
  beats,
  plan,
  envelope,
  height = 132,
  className,
}: {
  duration: number;
  shots: TimelineShot[];
  beats?: number[];
  plan?: RenderPlan | null;
  envelope?: number[];
  height?: number;
  className?: string;
}) {
  const [hover, setHover] = useState<{ x: number; ratio: number } | null>(null);
  const width = 1000;
  const safeDuration = Math.max(0.2, duration || 1);
  const scale = (t: number) => (Math.min(safeDuration, Math.max(0, t)) / safeDuration) * width;

  const hovered = useMemo(() => {
    if (!hover) return null;
    const t = hover.ratio * safeDuration;
    return shots.find((s) => t >= s.start && t < s.end) ?? null;
  }, [hover, shots, safeDuration]);

  const pillarBands = PILLAR_ORDER.map((pillar, index) => {
    const block = plan?.pillars.find((p) => p.pillar === pillar);
    const start = block?.start ?? (index * width) / 5;
    const end = block?.end ?? ((index + 1) * width) / 5;
    return {
      pillar,
      x: scale(start),
      w: Math.max(0.5, scale(end) - scale(start)),
    };
  });

  const maxEnv = envelope?.length ? Math.max(...envelope, 0.0001) : 1;

  return (
    <div className={clsx("relative", className)} onMouseLeave={() => setHover(null)}>
      <div
        className="relative w-full overflow-hidden rounded-lg border border-stroke/80 bg-ink/60 grid-stage"
        style={{ height }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          setHover({ x: ratio * width, ratio });
        }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {/* pillar bands */}
          {pillarBands.map(({ pillar, x, w }) => (
            <g key={pillar}>
              <rect x={x} y={0} width={w} height={height - 22} fill={PILLAR_ACCENT[pillar]} opacity={pillar % 2 === 0 ? 0.035 : 0.055} />
              <line x1={x} x2={x} y1={0} y2={height - 22} stroke="#21262D" strokeWidth={1} />
            </g>
          ))}

          {/* beat grid */}
          {(beats?.length ? beats : []).map((beat, i) => (
            <line
              key={`b-${i}`}
              x1={scale(beat)}
              x2={scale(beat)}
              y1={0}
              y2={height - 22}
              stroke="#E6EDF3"
              strokeOpacity={i % 4 === 0 ? 0.13 : 0.05}
              strokeWidth={i % 4 === 0 ? 0.9 : 0.5}
            />
          ))}

          {/* waveform strip */}
          {envelope?.length
            ? envelope.map((value, i) => {
                const w = width / envelope.length;
                const h = (value / maxEnv) * 26;
                return <rect key={i} x={i * w} y={height - 24 - h} width={Math.max(0.6, w - 0.4)} height={h} fill="#C9D1D9" opacity={0.18} />;
              })
            : null}

          {/* shot / slot blocks */}
          {shots.map((shot) => {
            const x = scale(shot.start);
            const w = Math.max(1.2, scale(shot.end) - scale(shot.start) - 0.8);
            const accent = PILLAR_ACCENT[shot.pillar];
            const energy = Math.max(0.22, shot.motion_energy ?? 0.5);
            return (
              <g key={shot.index}>
                <rect x={x} y={36} width={w} height={52} fill={accent} opacity={0.16 + energy * 0.22} rx={1.2} />
                <rect x={x} y={88} width={w} height={3} fill={accent} opacity={0.55} />
                {w > 16 ? (
                  <text x={x + 3} y={52} fill="#E6EDF3" opacity={0.55} fontSize={7.5} fontFamily="ui-monospace, monospace">
                    {shot.pillar}
                  </text>
                ) : null}
                {shot.transition !== "cut" && w > 8 ? (
                  <circle cx={x + 1.5} cy={32} r={2} fill="#E6EDF3" opacity={0.65} />
                ) : null}
                {shot.sfx ? <path d={`M ${x + w / 2 - 3} 22 L ${x + w / 2 + 3} 22 L ${x + w / 2} 28 Z`} fill="#C9D1D9" opacity={0.7} /> : null}
              </g>
            );
          })}

          {/* hover guide */}
          {hover ? <line x1={hover.x} x2={hover.x} y1={0} y2={height - 22} stroke="#E6EDF3" strokeOpacity={0.55} strokeDasharray="3 3" strokeWidth={1} /> : null}

          {/* ruler */}
          <line x1={0} x2={width} y1={height - 22} y2={height - 22} stroke="#21262D" strokeWidth={1} />
          {Array.from({ length: 11 }).map((_, i) => {
            const t = (i / 10) * safeDuration;
            const x = (i / 10) * width;
            return (
              <g key={`r-${i}`}>
                <line x1={x} x2={x} y1={height - 22} y2={height - 17} stroke="#30363D" strokeWidth={1} />
                <text x={Math.min(width - 26, x + 3)} y={height - 7} fill="#8B949E" fontSize={8} fontFamily="ui-monospace, monospace">
                  {formatClock(t)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* pillar labels (HTML so they stay crisp) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[18px]">
          {pillarBands.map(({ pillar, x, w }) => (
            <div key={pillar} className="relative overflow-hidden" style={{ width: `${(w / width) * 100}%`, marginLeft: pillar === 1 ? 0 : 0 }}>
              {w > 40 ? (
                <span className="absolute left-1 top-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-muted/80">
                  {PILLAR_META[pillar].short}
                </span>
              ) : null}
            </div>
          ))}
        </div>

        {hovered ? (
          <div
            className="pointer-events-none absolute z-20 -translate-y-full rounded-md border border-stroke bg-[#0b0d10]/95 px-2.5 py-1.5 shadow-silver"
            style={{ left: `${Math.min(92, hover!.ratio * 100)}%`, top: 4 }}
          >
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted">
              shot {hovered.index + 1} · p{hovered.pillar}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-paper">
              {hovered.start.toFixed(2)}s → {hovered.end.toFixed(2)}s · {hovered.duration.toFixed(2)}s
            </div>
            <div className="text-[10px] text-silver">
              {hovered.motion} · {hovered.transition}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {PILLAR_ORDER.map((pillar) => (
          <div key={pillar} className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-sm" style={{ background: PILLAR_ACCENT[pillar] }} />
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted">
              {PILLAR_META[pillar].short}
              <span className="ml-1 text-muted/50">{plan?.pillars.find((p) => p.pillar === pillar)?.shot_count ?? shots.filter((s) => s.pillar === pillar).length}</span>
            </span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-muted/70">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-3 bg-silver/30" /> beat grid
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-silver/70" /> transition SFX
          </span>
        </div>
      </div>
    </div>
  );
}
