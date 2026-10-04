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
};

/** About: where to ask for help and where the website is, each as something to tap. */
export function aboutView(): AboutView {
  const copy = mobileSettingsCopy.about;
  return {
    title: copy.title,
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
