/** How far one step of an action under way has got. */
export type StepStatus = "waiting" | "current" | "done" | "failed" | "skipped";

/** One line of a progress list, as both apps draw it. */
export type ProgressStep = {
  key: string;
  title: string;
  caption?: string;
  status: StepStatus;
  /** Overrides the status word, for example "Placing..." or "Not placed". */
  statusLabel?: string;
  /** Why a failed step failed. */
  reason?: string;
};
