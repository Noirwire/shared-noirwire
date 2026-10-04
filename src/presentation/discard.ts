import { commonCopy } from "../copy/common.js";

export type DiscardPromptView = {
  title: string;
  /** What discarding costs, so the choice is not made blind. */
  body: string;
  keep: string;
  discard: string;
};

/** Asked before leaving a sheet with something typed into it. */
export function discardPromptView(): DiscardPromptView {
  return {
    title: commonCopy.discardThis,
    body: commonCopy.discardBody,
    keep: commonCopy.keepEditing,
    discard: commonCopy.discard,
  };
}
