/** Layout primitives. Shared with the marketing site so the two cannot drift. */

export const container = "mx-auto w-full max-w-[480px] px-5 sm:px-6 lg:max-w-[1360px] lg:px-10";

export const containerNarrow = "mx-auto w-full max-w-[480px] px-5 sm:px-6";

export const panel = "rounded-panel border border-line-subtle bg-surface";

export const panelRaised = "rounded-panel border border-line bg-surface-raised";

export const lead = "text-[17px] leading-[1.65] text-dim";

export const eyebrow = "text-[12px] font-medium text-faint";

export const h1 =
  "text-[clamp(34px,6vw,54px)] font-medium leading-[1.04] tracking-[-0.04em] text-ink";

export const h2 =
  "text-[clamp(24px,3.2vw,34px)] font-medium leading-[1.1] tracking-[-0.035em] text-ink";

const btn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-tile px-5 text-[15px] font-medium transition-all duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-y-0";

export const btnPrimary = `${btn} bg-ink-strong text-base hover:bg-ink`;

export const btnGhost = `${btn} border border-line text-ink hover:border-line-strong`;

export const btnQuiet = `${btn} text-dim hover:text-ink`;

export const iconButton =
  "inline-flex h-11 w-11 items-center justify-center rounded-tile text-faint transition-colors duration-200 hover:bg-elevated hover:text-ink active:translate-y-px";

export const label = "text-[12px] font-medium text-faint";

export const row =
  "flex items-center justify-between gap-4 border-b border-line-subtle py-4 last:border-b-0";

export const overlay =
  "overlay-in fixed inset-0 z-50 flex items-end justify-center bg-base/85 p-0 sm:items-center sm:p-6";

export const dialog =
  "dialog-in max-h-[92dvh] w-full overflow-y-auto rounded-t-[16px] border border-line-subtle bg-surface p-6 shadow-[0_24px_64px_rgba(0,0,0,0.5)] sm:rounded-panel sm:p-7";

export const dialogActions = "mt-7 flex justify-end gap-3";

export const input =
  "min-h-11 min-w-0 w-full rounded-tile border border-line bg-elevated px-4 text-[15px] text-ink placeholder:text-faint";

export function chipClass(active: boolean) {
  return `min-h-11 rounded-full border px-4 py-2 text-[13px] whitespace-nowrap transition-colors duration-150 ${
    active
      ? "border-line-strong bg-surface-strong text-ink"
      : "border-line bg-surface text-dim hover:border-line-strong"
  }`;
}
