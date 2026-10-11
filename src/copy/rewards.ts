/** The Rewards screen: the Insider Preview, for a wallet that chose to join. */
export const rewardsCopy = {
  /** The screen's title, and what the app's navigation calls it. */
  title: "Rewards",
  /** The home screen's way in, for a wallet that has not joined. */
  promo: {
    title: "Join the Insider Preview",
    detail: "What you trade now is recorded and counts when Season 1 opens.",
    action: "See rewards",
    /** The same card while an invite is waiting on this device. */
    invited: {
      title: "You were invited to the NoirWire Insider Preview",
      detail: (boost: number, weeks: number) =>
        `Join with your invite and your trading score gets a ${boost}% boost for your first ${weeks} weeks.`,
      action: "Join now",
    },
  },
  /** Which member someone is, by the order of joining. `number` comes formatted. */
  member: {
    label: "Insider",
    value: (number: string) => `#${number}`,
    line: (number: string) => `Insider #${number}`,
  },
  /**
   * Which insider someone would be if they joined now. The count is as old
   * as the moment it was read, so both lines say "join now" and neither
   * promises the number. `insiders` is "1 insider" or "1,500 insiders".
   */
  next: {
    first: "Join now and you are insider #1.",
    after: (insiders: string, next: string) =>
      `${insiders} so far. Join now and you are insider #${next}.`,
  },
  /** The home screen's card for a wallet that has joined: bring someone in, or what unlocks that. */
  inviteCard: {
    active: {
      title: "Bring a friend into the preview",
      detail: (share: number, boost: number, weeks: number) =>
        `${share}% of their trading score counts for you too. They get a ${boost}% boost for their first ${weeks} weeks.`,
      action: "Share my invite",
    },
    /** Until the member's first trade is credited. The action leads to where there is something to trade. */
    locked: {
      title: "One trade unlocks your invite link",
      detail: (share: number) =>
        `After your first trade you get an invite link. ${share}% of your friends' trading score counts for you too.`,
      action: "Find something to trade",
    },
  },
  /** What a member sends to bring someone in. Each text is whole: nothing is added around it. */
  share: {
    /** How both texts open. */
    opening: (number: string) => `I am insider #${number} of the NoirWire Insider Preview.`,
    chat: (opening: string, link: string, boost: number, weeks: number, share: number) =>
      `${opening} Here is my invite: ${link}\nIf you opt in, your trading score gets a ${boost}% boost for ${weeks} weeks, and ${share}% of it counts toward mine too.`,
    /** The post's text. The link goes beside it, not in it. */
    x: (opening: string, boost: number, weeks: number, share: number) =>
      `${opening} Join with my invite and your trading score gets a ${boost}% boost for ${weeks} weeks; ${share}% of your score counts for me too.`,
    shareLabel: "Share my invite",
    xLabel: "Post on X",
    copied: "Invite copied",
  },
  /** Shown where a wallet is created or restored, while an invite is waiting on this device. */
  invitedBanner: {
    title: "Someone invited you to the NoirWire Insider Preview",
    detail: (boost: number, weeks: number) =>
      `Create a wallet, then join in Rewards. Your trading score gets a ${boost}% boost for your first ${weeks} weeks, and joining is optional.`,
  },
  /**
   * What there is to earn, said first to a wallet that has not joined. Its
   * title is the promo's. The inviting rules come from the constants the
   * scoring keeps to.
   */
  pitch: {
    preview: "This is the Insider Preview: NoirWire before Season 1.",
    recorded: "The fees your trades pay are recorded as your trading score, week by week.",
    credited: "When Season 1 opens, insiders are credited for what they did in the preview.",
    until:
      "The preview runs until at least 100 insiders are in. Season 1's rules are published before it starts.",
    /** Said first while an invite is waiting on this device. */
    invited: (boost: number, weeks: number) =>
      `Your invite gives your trading score a ${boost}% boost for your first ${weeks} weeks.`,
    invite: (share: number, boost: number, weeks: number) =>
      `After your first trade you get an invite link: ${share}% of each invited person's trading score counts for you too, and they get a ${boost}% boost for their first ${weeks} weeks.`,
  },
  /** The only thing said about a token, anywhere. */
  token: "If NoirWire ever launches a token, points decide who gets it.",

  join: {
    explanation: [
      "Joining is optional.",
      "While a trade is being checked, our server sees which portfolio earned it, and does not keep that.",
      "Your rewards are tied to a separate key that comes from your recovery phrase.",
    ],
    inviteCode: "Invite code (optional)",
    /** Said beside the field while a code that could be one is in it, so the person sees it will be used. */
    inviteApplied: {
      label: "Invite code in use",
      detail: (boost: number, weeks: number) =>
        `Joining with this code gives your trading score a ${boost}% boost for your first ${weeks} weeks.`,
    },
    /** Said of text in the field that no code could be. `length` is how long a code is. */
    inviteShape: (length: number) =>
      `That does not look like an invite code. Codes are ${length} letters and numbers.`,
    button: "Join rewards",
    /** The button's label while the joining is under way. */
    busy: "Joining",
    inviteNotValid: "That invite code is not valid. Check it, or join without one.",
    failed: "You have not joined yet. Try again in a moment.",
  },

  week: {
    fee: "Your trade fees recorded this week",
  },
  invite: {
    code: "Your invite code",
    link: "Your invite link",
    /** The accessible names of the two copy buttons. */
    copyCode: "Copy invite code",
    copyLink: "Copy invite link",
    /**
     * The whole invite section until the member's first trade is credited:
     * what unlocks the link, said as its headline, and where to go to do it.
     */
    locked: {
      title: "Your invite link unlocks after your first trade",
      detail: (share: number) =>
        `Make one trade and you get a link to share. ${share}% of each invited person's trading score counts toward yours.`,
      action: "Find something to trade",
    },
    invited: "People you invited",
    /** The section's headline, by how many have joined with the code. */
    headline: {
      none: "Invite a friend",
      one: "One joined. Who's next?",
      two: "Two joined. Who's next?",
      many: (count: string) => `${count} joined. Who's next?`,
    },
    ask: (share: number) => `${share}% of each invited person's trading score counts toward yours.`,
  },
  /** Said to a member who joined with an invite, while its boost lasts. `left` is "3 weeks" or "1 week". */
  boost: {
    title: "Your invite worked",
    left: (boost: number, left: string) =>
      `Your trading score has a ${boost}% boost. ${left} left.`,
  },
  /** Said on a member's standing, of what the preview keeps of their trading. */
  recorded: "What you do in the preview is recorded and counts when Season 1 opens.",
  /** Said when the wallet has joined and its standing could not be read. */
  notNow: "Your rewards cannot be shown right now. Everything is kept.",
};
