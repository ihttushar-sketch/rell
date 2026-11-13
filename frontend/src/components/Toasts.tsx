"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useStudio } from "@/lib/store";

export function Toasts() {
  const { toasts, dismissToast } = useStudio();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            "pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-silver backdrop-blur-md",
            toast.tone === "ok" && "border-silver/25 bg-[#151a21]/95",
            toast.tone === "error" && "border-red-900/60 bg-[#1b1113]/95",
            toast.tone === "info" && "border-stroke bg-[#11151b]/95",
          )}
        >
          <span className="mt-0.5 shrink-0">
            {toast.tone === "ok" ? (
              <CheckCircle2 size={14} className="text-silver" />
            ) : toast.tone === "error" ? (
              <AlertTriangle size={14} className="text-red-400" />
            ) : (
              <Info size={14} className="text-muted" />
            )}
          </span>
          <p className={clsx("flex-1 text-[11.5px] leading-snug", toast.tone === "error" ? "text-red-200" : "text-silver")}>{toast.message}</p>
          <button onClick={() => dismissToast(toast.id)} className="shrink-0 text-muted hover:text-paper">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
