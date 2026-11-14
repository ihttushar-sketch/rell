"use client";

import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { ReactNode } from "react";

export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  return <Tag className={clsx("panel", className)}>{children}</Tag>;
}

export function PanelHead({
  title,
  eyebrow,
  icon,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("panel-head", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? <span className="text-muted">{icon}</span> : null}
        <div className="min-w-0">
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h2 className="truncate text-[13px] font-medium tracking-tight text-paper">{title}</h2>
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Button({
  children,
  variant = "ghost",
  size = "md",
  loading,
  icon,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "silver" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        "btn focus-ring",
        variant === "primary" && "btn-primary",
        variant === "silver" && "btn-silver",
        variant === "ghost" && "btn-ghost",
        variant === "danger" && "btn-danger",
        size === "sm" && "px-2.5 py-1.5 text-[11px]",
        size === "lg" && "px-5 py-3 text-sm",
        className,
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "live" | "ok" | "warn" | "muted";
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.14em]",
        tone === "neutral" && "border-stroke bg-ink/60 text-silver",
        tone === "muted" && "border-stroke/70 bg-transparent text-muted",
        tone === "live" && "border-silver/30 bg-silver/10 text-paper",
        tone === "ok" && "border-emerald-900/70 bg-emerald-950/30 text-emerald-300",
        tone === "warn" && "border-amber-900/70 bg-amber-950/25 text-amber-300",
        className,
      )}
    >
      {tone === "ok" || tone === "live" ? <span className="dot-live h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  mono = true,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("rounded-lg border border-stroke/80 bg-ink/40 px-3 py-2.5", className)}>
      <div className="eyebrow">{label}</div>
      <div className={clsx("mt-1 text-[15px] leading-none text-paper", mono && "font-mono")}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-tight text-muted">{hint}</div> : null}
    </div>
  );
}

export function Progress({
  value,
  className,
  indeterminate,
}: {
  value: number;
  className?: string;
  indeterminate?: boolean;
}) {
  return (
    <div className={clsx("relative h-1 w-full overflow-hidden rounded-full bg-stroke/70", className)}>
      {indeterminate ? (
        <div className="absolute inset-y-0 w-1/3 animate-sweep bg-silver/70" />
      ) : (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-silver transition-[width] duration-300 ease-out"
          style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
        />
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="eyebrow block">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? <div className="mt-1.5 text-[11px] leading-snug text-muted">{hint}</div> : null}
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  options: Array<{ value: T; label: ReactNode; hint?: string; disabled?: boolean }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={clsx("inline-flex rounded-lg border border-stroke bg-ink/60 p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          title={option.hint}
          className={clsx(
            "focus-ring rounded-[7px] font-medium transition disabled:cursor-not-allowed disabled:opacity-30",
            size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]",
            value === option.value ? "bg-silver/15 text-paper shadow-[inset_0_0_0_1px_rgba(201,209,217,0.22)]" : "text-muted hover:text-silver",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={clsx("flex cursor-pointer items-start gap-2.5", disabled && "cursor-not-allowed opacity-50")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "focus-ring mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition",
          checked ? "border-silver bg-silver text-ink" : "border-stroke bg-ink text-transparent",
        )}
      >
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 6.2 4.6 8.8 10 3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="min-w-0">
        <span className="block text-[12.5px] leading-tight text-silver">{label}</span>
        {hint ? <span className="mt-0.5 block text-[11px] leading-snug text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 text-muted/70">{icon}</div>
      <div className="text-[13px] font-medium text-silver">{title}</div>
      <p className="max-w-sm text-[12px] leading-relaxed text-muted">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
