"use client";

import clsx from "clsx";
import {
  Copy,
  Download,
  Eye,
  FileJson,
  FolderOpen,
  HardDriveDownload,
  Layers,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { formatClock, formatDuration } from "@/lib/scaler";
import { formatDate } from "@/lib/format";
import { useStudio } from "@/lib/store";
import { FrameworkDna } from "@/lib/types";
import { Badge, Button, EmptyState, Panel, PanelHead, formatBytes } from "./ui";

function downloadJson(dna: FrameworkDna) {
  const blob = new Blob([JSON.stringify(dna, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${dna.framework_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${dna.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function VaultTab() {
  const { frameworks, removeFramework, importBlueprints, setSelected, setTab, toast, engine } = useStudio();
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const inspected = frameworks.find((f) => f.id === inspectId) ?? null;

  const totals = useMemo(() => {
    const duration = frameworks.reduce((sum, f) => sum + f.duration_sec, 0);
    const cuts = frameworks.reduce((sum, f) => sum + f.shots.length, 0);
    const raw = frameworks.reduce((sum, f) => sum + JSON.stringify(f).length, 0);
    return { duration, cuts, bytes: raw };
  }, [frameworks]);

  const onImport = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as FrameworkDna | { frameworks: FrameworkDna[] };
      const list = Array.isArray(parsed) ? parsed : "frameworks" in parsed ? parsed.frameworks : [parsed as FrameworkDna];
      if (!Array.isArray(list) || !list.length) throw new Error("No frameworks array found");
      await importBlueprints(list);
    } catch (err) {
      toast("error", `Import failed: ${err instanceof Error ? err.message : "invalid JSON"}`);
    }
  };

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHead
          eyebrow="Digital assets"
          title="Framework DNA vault"
          icon={<Layers size={15} />}
          actions={
            <>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => void onImport(event.target.files?.[0] ?? null)}
              />
              <Button size="sm" variant="ghost" icon={<Upload size={12} />} onClick={() => fileRef.current?.click()}>
                Import JSON
              </Button>
              <Button size="sm" variant="silver" icon={<FolderOpen size={12} />} onClick={() => setTab("extractor")}>
                Observe new
              </Button>
            </>
          }
        />
        <div className="grid grid-cols-2 gap-3 border-b border-stroke/70 px-5 py-4 sm:grid-cols-4">
          {[
            { label: "Frameworks", value: frameworks.length },
            { label: "Reusable runtime", value: formatClock(totals.duration) },
            { label: "Mapped cuts", value: totals.cuts },
            { label: "Blueprint size", value: formatBytes(totals.bytes) },
          ].map((item) => (
            <div key={item.label}>
              <div className="eyebrow">{item.label}</div>
              <div className="mt-0.5 font-mono text-[16px] text-paper">{item.value}</div>
            </div>
          ))}
        </div>

        {frameworks.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-stroke/70 text-muted">
                  {["Framework", "Origin", "Length", "BPM", "Cuts", "Avg shot", "Format", "Created", ""].map((head) => (
                    <th key={head} className="whitespace-nowrap px-4 py-2.5 font-mono text-[9px] font-normal uppercase tracking-[0.16em]">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {frameworks.map((dna) => (
                  <tr key={dna.id} className="group border-b border-stroke/40 transition hover:bg-white/[0.018]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-stroke bg-ink/60">
                          <FileJson size={12} className="text-silver" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[12.5px] text-paper">{dna.framework_name}</div>
                          <div className="mt-0.5 flex gap-1">
                            {dna.tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="font-mono text-[9px] uppercase tracking-wider text-muted/80">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={dna.origin === "server" ? "ok" : dna.origin === "browser" ? "live" : "muted"}>{dna.origin}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-silver">{formatDuration(dna.duration_sec)}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-silver">{dna.audio.bpm || "—"}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-silver">{dna.shots.length}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-silver">{dna.stats.avg_clip_duration.toFixed(2)}s</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted">{dna.source.aspect}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[10.5px] text-muted">
                      {formatDate(dna.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1 opacity-60 transition group-hover:opacity-100">
                        <button
                          title="Inspect blueprint"
                          onClick={() => setInspectId(dna.id)}
                          className="focus-ring rounded border border-transparent p-1.5 text-muted hover:border-stroke hover:text-paper"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          title="Produce with this framework"
                          onClick={() => {
                            setSelected(dna.id);
                            setTab("produce");
                          }}
                          className="focus-ring rounded border border-transparent p-1.5 text-muted hover:border-stroke hover:text-paper"
                        >
                          <Layers size={13} />
                        </button>
                        <button
                          title="Export JSON"
                          onClick={() => downloadJson(dna)}
                          className="focus-ring rounded border border-transparent p-1.5 text-muted hover:border-stroke hover:text-paper"
                        >
                          <Download size={13} />
                        </button>
                        <button
                          title="Delete"
                          onClick={() => setConfirmDelete(dna.id)}
                          className="focus-ring rounded border border-transparent p-1.5 text-muted hover:border-red-900/60 hover:text-red-400"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<FileJson size={26} />}
            title="No blueprints stored"
            body="Import a .json Framework DNA or observe a reference video to create one. Blueprints are portable across clients and machines."
            action={
              <Button variant="silver" size="sm" icon={<Upload size={12} />} onClick={() => fileRef.current?.click()}>
                Import blueprint
              </Button>
            }
          />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[10px] text-muted/70">
          <span className="flex items-center gap-1.5">
            <HardDriveDownload size={11} /> {engine === "server" ? "synced with SQLite on the production node" : "cached in this browser (localStorage)"}
          </span>
          <span className="ml-auto font-mono">schema 1.0 · portable DNA</span>
        </div>
      </Panel>

      {inspected ? (
        <Panel>
          <PanelHead
            eyebrow="Blueprint inspector"
            title={inspected.framework_name}
            icon={<FileJson size={15} />}
            actions={
              <>
                <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={() => {
                  void navigator.clipboard?.writeText(JSON.stringify(inspected, null, 2));
                  toast("info", "Blueprint JSON copied to clipboard.");
                }}>
                  Copy
                </Button>
                <Button size="sm" variant="ghost" icon={<Download size={12} />} onClick={() => downloadJson(inspected)}>
                  Export
                </Button>
                <button onClick={() => setInspectId(null)} className="focus-ring rounded p-1 text-muted hover:text-paper">
                  <X size={14} />
                </button>
              </>
            }
          />
          <div className="grid gap-4 p-5 lg:grid-cols-[1fr_1.25fr]">
            <div className="space-y-3">
              <p className="text-[11.5px] leading-relaxed text-muted">{inspected.description || "No description supplied."}</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ["Framework id", inspected.id],
                  ["Schema", inspected.schema_version],
                  ["Source", inspected.source.label],
                  ["Aspect", inspected.source.aspect],
                  ["BPM", `${inspected.audio.bpm}`],
                  ["Beats", `${inspected.audio.beat_timestamps.length}`],
                  ["Shots", `${inspected.shots.length}`],
                  ["SFX cues", `${inspected.sfx_events.length}`],
                  ["Stems", inspected.audio.stems.bgm ? "isolated" : "reference mix"],
                  ["Watermark", `${inspected.watermark.text} · ${inspected.watermark.position}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-stroke/70 bg-ink/40 px-2.5 py-2">
                    <div className="eyebrow">{label}</div>
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-silver">{value}</div>
                  </div>
                ))}
              </div>
            </div>
            <pre className="max-h-[420px] overflow-auto rounded-lg border border-stroke/70 bg-[#080A0C] p-3 font-mono text-[10px] leading-relaxed text-muted">
              {JSON.stringify(inspected, null, 2)}
            </pre>
          </div>
        </Panel>
      ) : null}

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} aria-label="Close" />
          <div className="relative w-full max-w-sm animate-rise rounded-xl border border-silver/15 bg-[#11151b] p-5 shadow-silver">
            <h3 className="text-[14px] text-paper">Delete framework?</h3>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
              The blueprint will be removed from the vault{engine === "server" ? " and the production node database" : ""}. Exported JSON copies are unaffected.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                Keep
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={12} />}
                onClick={() => {
                  void removeFramework(confirmDelete);
                  if (inspectId === confirmDelete) setInspectId(null);
                  setConfirmDelete(null);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
