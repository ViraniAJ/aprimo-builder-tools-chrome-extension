// Small shared UI pieces for the panel and the settings page (Tailwind, no component library).
import type { ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({ children, onClick, kind = "default", disabled, title, small, type = "button" }: { children: ReactNode; onClick?: () => void; kind?: "default" | "primary" | "danger" | "ghost"; disabled?: boolean; title?: string; small?: boolean; type?: "button" | "submit" }) {
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={cx("inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors", small ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm",
        kind === "primary" && "border-primary bg-primary text-primary-fg hover:opacity-90",
        kind === "danger" && "border-danger/40 text-danger hover:bg-danger/10",
        kind === "ghost" && "border-transparent text-muted hover:bg-soft hover:text-fg",
        kind === "default" && "border-line bg-card hover:bg-soft")}>
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, help, disabled, locked }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; help?: ReactNode; disabled?: boolean; locked?: boolean }) {
  return (
    <label className={cx("flex items-start gap-3 py-2", (disabled || locked) && "opacity-60")}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled || locked} onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-line")}>
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-4.5" : "left-0.5")} />
      </button>
      <span className="min-w-0">
        <span className="block font-medium">{label}{locked && <Locked />}</span>
        {help && <span className="block text-xs text-muted">{help}</span>}
      </span>
    </label>
  );
}

export const Locked = () => <span className="ml-2 rounded bg-soft px-1.5 py-0.5 text-[10px] font-semibold text-muted">Managed by your organization</span>;

export function Field({ label, help, children, locked }: { label: ReactNode; help?: ReactNode; children: ReactNode; locked?: boolean }) {
  return (
    <div className="py-2">
      <div className="mb-1 text-sm font-medium">{label}{locked && <Locked />}</div>
      {children}
      {help && <div className="mt-1 text-xs text-muted">{help}</div>}
    </div>
  );
}

export const inputCls = "w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-60";

export function Select<T extends string>({ value, onChange, options, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean }) {
  return (
    <select className={inputCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-card p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(o.value)}
          className={cx("rounded-md px-3 py-1 text-sm", value === o.value ? "bg-primary text-primary-fg" : "text-muted hover:text-fg")}>{o.label}</button>
      ))}
    </div>
  );
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-line bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Range({ value, onChange, min, max, step, format, disabled }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; format?: (v: number) => string; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" className="w-full accent-[var(--w-primary)]" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="w-14 text-right text-xs tabular-nums text-muted">{format ? format(value) : value}</span>
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-line"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} /></div>;
}

export function WispMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <defs><linearGradient id="wm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2B6BFF" /><stop offset="1" stopColor="#9BE832" /></linearGradient></defs>
      <path d="M4 2 L4 24 L9.6 18.6 L13.4 27 L17 25.4 L13.3 17.2 L21.4 17 Z" fill="url(#wm)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
