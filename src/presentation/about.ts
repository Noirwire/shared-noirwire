import { appCopy } from "../copy/app.js";
import { mobileSettingsCopy } from "../copy/settings.js";

/** A row that opens something outside the app: a mail to write, or a page to visit. */
export type AboutLink = {
  label: string;
  /** What is shown: the address or the site's name. */
  value: string;
  action: { kind: "email" | "website"; url: string };
};

export type AboutView = {
  title: string;
  help: AboutLink;
  website: AboutLink;
  /** That NoirWire is in testing, said as one line on the page. */
  beta: string;
};

export type BetaView = {
  /** A small label beside the NoirWire mark, in the app's header and on Welcome. */
  tag: string;
  /** The line for Settings' About page (`aboutView().beta`). */
  line: string;
};

/**
 * That NoirWire is in testing. It takes no network: the note is about the
 * product, so it is shown on the main network exactly as on a test one.
 */
export function betaView(): BetaView {
  return { tag: appCopy.beta.tag, line: appCopy.beta.line };
}

/**
 * About: where to ask for help and where the website is, each as something
 * to tap, and the line saying NoirWire is in testing.
 */
export function aboutView(): AboutView {
  const copy = mobileSettingsCopy.about;
  return {
    title: copy.title,
    beta: betaView().line,
    help: {
      label: copy.help,
      value: copy.helpContact,
      action: { kind: "email", url: `mailto:${copy.helpContact}` },
    },
    website: {
      label: copy.website,
      value: copy.websiteValue,
      action: { kind: "website", url: `https://${copy.websiteValue}` },
    },
  };
}
