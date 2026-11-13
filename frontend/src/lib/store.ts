"use client";

/**
 * Studio state. Framework blueprints live in the Production Vault — mirrored to
 * the Python node when it is online, and to localStorage when the studio runs
 * server-less. Binary media (File objects) is intentionally memory-only.
 */

import { create } from "zustand";
import { SAMPLE_FRAMEWORKS } from "./samples";
import { Capabilities, FrameworkDna, PillarId } from "./types";
import * as api from "./api";

export type TabKey = "extractor" | "produce" | "vault";
export type EngineMode = "checking" | "server" | "browser";

const VAULT_KEY = "nexus.frame.vault.v1";
const SELECTED_KEY = "nexus.frame.selected.v1";

export interface Toast {
  id: string;
  tone: "ok" | "error" | "info";
  message: string;
}

export interface StudioState {
  tab: TabKey;
  engine: EngineMode;
  capabilities: Capabilities | null;
  frameworks: FrameworkDna[];
  selectedId: string | null;
  draft: FrameworkDna | null;
  /** Source audio of the most recent analysis — powers "Framework BG". */
  referenceAudio: File | null;
  referenceFile: File | null;
  toasts: Toast[];
  hydrating: boolean;

  setTab: (tab: TabKey) => void;
  detectEngine: () => Promise<void>;
  hydrateVault: () => Promise<void>;
  setDraft: (dna: FrameworkDna | null) => void;
  setSelected: (id: string) => void;
  setReferenceAudio: (file: File | null, source?: File | null) => void;
  saveDraft: (name: string, tags: string[], description?: string) => Promise<FrameworkDna | null>;
  removeFramework: (id: string) => Promise<void>;
  importBlueprints: (blueprints: FrameworkDna[]) => Promise<void>;
  getFramework: (id: string | null) => FrameworkDna | null;
  toast: (tone: Toast["tone"], message: string) => void;
  dismissToast: (id: string) => void;
}

function readLocal(): FrameworkDna[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VAULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FrameworkDna[]) : null;
  } catch {
    return null;
  }
}

function writeLocal(frameworks: FrameworkDna[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VAULT_KEY, JSON.stringify(frameworks));
  } catch {
    /* quota or privacy mode */
  }
}

function titleCase(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const useStudio = create<StudioState>((set, get) => ({
  tab: "extractor",
  engine: "checking",
  capabilities: null,
  frameworks: [],
  selectedId: null,
  draft: null,
  referenceAudio: null,
  referenceFile: null,
  toasts: [],
  hydrating: true,

  setTab: (tab) => set({ tab }),

  detectEngine: async () => {
    const capabilities = await api.fetchCapabilities();
    set({ engine: capabilities ? "server" : "browser", capabilities });
  },

  hydrateVault: async () => {
    const local = readLocal();
    const seeded = local && local.length ? local : SAMPLE_FRAMEWORKS.map((f) => ({ ...f }));
    set({ frameworks: seeded, hydrating: true });

    const caps = await api.fetchCapabilities();
    if (caps) {
      try {
        let serverFrameworks = await api.listFrameworks();
        if (!serverFrameworks.length) {
          for (const framework of seeded) {
            try {
              await api.saveFramework(framework);
            } catch {
              /* keep going */
            }
          }
          serverFrameworks = await api.listFrameworks();
        }
        const merged = new Map<string, FrameworkDna>();
        for (const f of seeded) merged.set(f.id, f);
        for (const f of serverFrameworks) merged.set(f.id, f);
        const frameworks = [...merged.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
        set({ engine: "server", capabilities: caps, frameworks, hydrating: false });
        writeLocal(frameworks);
      } catch {
        set({ engine: "server", capabilities: caps, hydrating: false });
      }
    } else {
      set({ engine: "browser", capabilities: null, hydrating: false });
    }

    const stored = typeof window !== "undefined" ? window.localStorage.getItem(SELECTED_KEY) : null;
    const current = get().selectedId;
    const list = get().frameworks;
    const nextId = current ?? (stored && list.some((f) => f.id === stored) ? stored : list[0]?.id ?? null);
    set({ selectedId: nextId });
  },

  setDraft: (dna) => set({ draft: dna }),

  setSelected: (id) => {
    set({ selectedId: id });
    if (typeof window !== "undefined") window.localStorage.setItem(SELECTED_KEY, id);
  },

  setReferenceAudio: (file, source) =>
    set((state) => ({ referenceAudio: file, referenceFile: source ?? state.referenceFile })),

  saveDraft: async (name, tags, description) => {
    const draft = get().draft;
    if (!draft) return null;
    const cleaned = name.trim();
    if (!cleaned) {
      get().toast("error", "A framework name is required.");
      return null;
    }
    const dna: FrameworkDna = {
      ...draft,
      id: draft.id.startsWith("fw_") && !get().frameworks.some((f) => f.id === draft.id) ? draft.id : `fw_${Date.now().toString(36)}`,
      framework_name: cleaned,
      tags: tags.length ? tags : draft.tags,
      description: description?.trim() || draft.description,
      created_at: new Date().toISOString(),
      origin: get().engine === "server" ? "server" : "browser",
    };
    let saved = dna;
    if (get().engine === "server") {
      try {
        saved = await api.saveFramework(dna);
      } catch {
        get().toast("info", "Production node unreachable — framework kept locally.");
      }
    }
    const frameworks = [...get().frameworks.filter((f) => f.id !== saved.id), saved].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    writeLocal(frameworks);
    set({ frameworks, selectedId: saved.id, draft: null });
    get().toast("ok", `“${titleCase(saved.framework_name)}” locked into the Production Vault.`);
    return saved;
  },

  removeFramework: async (id) => {
    if (get().engine === "server") {
      try {
        await api.deleteFramework(id);
      } catch {
        /* local removal still proceeds */
      }
    }
    const frameworks = get().frameworks.filter((f) => f.id !== id);
    writeLocal(frameworks);
    set({ frameworks, selectedId: get().selectedId === id ? frameworks[0]?.id ?? null : get().selectedId });
    get().toast("info", "Framework removed from the vault.");
  },

  importBlueprints: async (blueprints) => {
    const valid = blueprints.filter((b) => b && b.id && Array.isArray(b.shots));
    if (!valid.length) {
      get().toast("error", "No valid Framework DNA found in that file.");
      return;
    }
    let stored = valid;
    if (get().engine === "server") {
      try {
        stored = await api.importFrameworks({ frameworks: valid });
        if (!stored.length) stored = valid;
      } catch {
        /* fall back to local */
      }
    }
    const merged = new Map(get().frameworks.map((f) => [f.id, f] as const));
    for (const f of stored) merged.set(f.id, { ...f, origin: f.origin ?? "import" });
    const frameworks = [...merged.values()];
    writeLocal(frameworks);
    set({ frameworks, selectedId: frameworks[frameworks.length - 1]?.id ?? null });
    get().toast("ok", `${valid.length} blueprint${valid.length > 1 ? "s" : ""} imported.`);
  },

  getFramework: (id) => {
    if (!id) return null;
    return get().frameworks.find((f) => f.id === id) ?? null;
  },

  toast: (tone, message) => {
    const id = Math.random().toString(36).slice(2);
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, tone, message }] }));
    setTimeout(() => get().dismissToast(id), 5200);
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const PILLAR_ACCENT: Record<PillarId, string> = {
  1: "#E6EDF3",
  2: "#9AA6B2",
  3: "#C9D1D9",
  4: "#7F8B98",
  5: "#5C6672",
};

export function engineLabel(engine: EngineMode, caps: Capabilities | null): { label: string; detail: string; tone: "ok" | "idle" } {
  if (engine === "server" && caps) {
    const missing = [
      !caps.ffmpeg && "ffmpeg",
      !caps.opencv && "opencv",
      !caps.demucs && "demucs",
      !caps.ytdlp && "yt-dlp",
    ].filter(Boolean);
    return {
      label: "Production node",
      detail: missing.length ? `degraded · ${missing.join(", ")}` : "all engines online",
      tone: "ok",
    };
  }
  if (engine === "browser") return { label: "Studio lite", detail: "in-browser DSP + renderer", tone: "idle" };
  return { label: "Linking", detail: "probing production node", tone: "idle" };
}
