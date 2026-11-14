"use client";

import { useEffect, useState } from "react";
import { Lock, Tag, X } from "lucide-react";
import { FrameworkDna } from "@/lib/types";
import { Button } from "./ui";

export function SaveFrameworkModal({
  open,
  dna,
  onClose,
  onSave,
}: {
  open: boolean;
  dna: FrameworkDna | null;
  onClose: () => void;
  onSave: (name: string, tags: string[], description?: string) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(dna?.framework_name ?? "");
    setTags((dna?.tags ?? []).join(", "));
    setDescription(dna?.description ?? "");
    setError(null);
    setSaving(false);
  }, [open, dna]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !dna) return null;

  const submit = async () => {
    if (!name.trim()) {
      setError("Framework name is required — it is the vault key.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(
        name.trim(),
        tags
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 8),
        description.trim(),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save framework");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-lg animate-rise rounded-xl border border-silver/15 bg-[#11151b] shadow-silver">
        <div className="flex items-start justify-between border-b border-stroke/80 px-5 py-4">
          <div>
            <div className="eyebrow">Production vault</div>
            <h3 className="mt-0.5 text-[15px] font-medium text-paper">Lock framework DNA</h3>
          </div>
          <button onClick={onClose} className="focus-ring rounded p-1 text-muted hover:text-paper">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-stroke/70 bg-ink/50 p-2.5">
            {[
              { label: "Shots", value: dna.stats.cuts },
              { label: "BPM", value: dna.audio.bpm || "—" },
              { label: "Avg shot", value: `${dna.stats.avg_clip_duration.toFixed(2)}s` },
            ].map((item) => (
              <div key={item.label}>
                <div className="eyebrow">{item.label}</div>
                <div className="font-mono text-[13px] text-paper">{item.value}</div>
              </div>
            ))}
          </div>

          <label className="block">
            <span className="eyebrow">Framework name *</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              placeholder="e.g. Fast Hormozi Style"
              className="input mt-1.5"
            />
          </label>

          <label className="block">
            <span className="eyebrow flex items-center gap-1.5">
              <Tag size={10} /> Tags
            </span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="fast, talking-head, 9:16"
              className="input mt-1.5"
            />
            <span className="mt-1 block text-[11px] text-muted">Comma separated, max 8.</span>
          </label>

          <label className="block">
            <span className="eyebrow">Note (optional)</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="What makes this edit convert?"
              className="input mt-1.5 resize-none"
            />
          </label>

          {error ? <p className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-[12px] text-red-300">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-stroke/80 px-5 py-3.5">
          <span className="text-[10.5px] text-muted">Portable JSON + stems · reusable on any client project</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={saving} icon={<Lock size={13} />} onClick={() => void submit()}>
              Save framework
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
