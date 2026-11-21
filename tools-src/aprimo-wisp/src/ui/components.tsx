// Small shared UI pieces for the panel and the settings page, styled like Aprimo's admin screens (MUI: uppercase
// teal buttons, teal switches, outlined fields, white 4px paper).
import type { ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({ children, onClick, kind = "default", disabled, title, small, type = "button" }: { children: ReactNode; onClick?: () => void; kind?: "default" | "primary" | "danger" | "ghost"; disabled?: boolean; title?: string; small?: boolean; type?: "button" | "submit" }) {
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={cx("wisp-label inline-flex items-center justify-center gap-1.5 rounded-lg border transition-colors disabled:text-black/40",
        small ? "px-2 py-0.5 !text-[12px] !tracking-[1px]" : "px-3 py-1.5",
        kind === "primary" && "border-primary bg-primary text-primary-fg shadow-[0_1px_3px_rgba(0,0,0,.2),0_2px_2px_rgba(0,0,0,.14)] hover:bg-[var(--w-primary-hover)] disabled:border-transparent disabled:bg-black/10 disabled:shadow-none",
        kind === "danger" && "border-danger/50 text-danger hover:bg-danger/5",
        kind === "ghost" && "border-transparent text-primary hover:bg-soft",
        kind === "default" && "border-primary/50 bg-white text-primary hover:border-primary hover:bg-soft disabled:border-black/10")}>
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, help, disabled, locked }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; help?: ReactNode; disabled?: boolean; locked?: boolean }) {
  // MUI switch: 34x14 track, 20px thumb.
  return (
    <label className={cx("flex items-start gap-3 py-2", (disabled || locked) && "opacity-60")}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled || locked} onClick={() => onChange(!checked)} className="relative mt-0.5 h-5 w-9 shrink-0">
        <span className={cx("absolute left-0.5 right-0.5 top-[3px] h-3.5 rounded-full transition-colors", checked ? "bg-primary/50" : "bg-black/40")} />
        <span className={cx("absolute top-0 h-5 w-5 rounded-full shadow-[0_2px_1px_-1px_rgba(0,0,0,.2),0_1px_1px_0_rgba(0,0,0,.14),0_1px_3px_0_rgba(0,0,0,.12)] transition-all", checked ? "left-4 bg-primary" : "left-0 bg-white")} />
      </button>
      <span className="min-w-0">
        <span className="block">{label}{locked && <Locked />}</span>
        {help && <span className="block text-xs text-muted">{help}</span>}
      </span>
    </label>
  );
}

export const Locked = () => <span className="ml-2 rounded-full bg-black/[.08] px-2 py-0.5 text-[11px] text-muted">Managed by your organization</span>;

export function Field({ label, help, children, locked }: { label: ReactNode; help?: ReactNode; children: ReactNode; locked?: boolean }) {
  return (
    <div className="py-2">
      <div className="mb-1 text-[12.25px] text-muted">{label}{locked && <Locked />}</div>
      {children}
      {help && <div className="mt-1 text-xs text-muted">{help}</div>}
    </div>
  );
}

export const inputCls = "w-full rounded-lg border border-black/[.23] bg-white px-3 py-2 text-sm outline-none hover:border-black/90 focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--w-primary)] disabled:opacity-60";

export function Select<T extends string>({ value, onChange, options, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean }) {
  return (
    <select className={inputCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-primary/50">
      {options.map((o, i) => (
        <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(o.value)}
          className={cx("wisp-label px-3 py-1", i > 0 && "border-l border-primary/50", value === o.value ? "bg-primary/[.12] text-primary" : "bg-white text-primary hover:bg-soft")}>{o.label}</button>
      ))}
    </div>
  );
}

/** An Aprimo outlined card; `icon` adds the teal tile Aprimo's admin cards have. */
export function Section({ title, children, right, icon }: { title: ReactNode; children: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <section className="mb-4 rounded-lg border border-line bg-white">
      <div className="flex min-h-14 items-center justify-between gap-2 px-4 pt-3">
        <h2 className="flex items-center gap-3 text-[18px] font-medium">{icon && <span className="wisp-tile h-9 w-9">{icon}</span>}{title}</h2>
        {right}
      </div>
      <div className="px-4 py-2">{children}</div>
    </section>
  );
}

export function Range({ value, onChange, min, max, step, format, disabled }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; format?: (v: number) => string; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" className="w-full accent-[#008080]" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="w-14 text-right text-xs tabular-nums text-muted">{format ? format(value) : value}</span>
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return <div className="h-1 w-full overflow-hidden bg-primary/20"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} /></div>;
}

/** Wisp's pointer in Aprimo teal. */
export function WispMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true">
      <defs><linearGradient id="wm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#006d6d" /><stop offset="1" stopColor="#4db6ac" /></linearGradient></defs>
      <path d="M4 2 L4 24 L9.6 18.6 L13.4 27 L17 25.4 L13.3 17.2 L21.4 17 Z" fill="url(#wm)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
