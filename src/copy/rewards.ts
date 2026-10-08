/** The Rewards screen: points for trades, for a wallet that chose to join. */
export const rewardsCopy = {
  title: "Rewards",
  /** What the app's navigation calls the screen. */
  nav: "Rewards",
  /** The home screen's way in, for a wallet that has not joined. `points` is what one week splits. */
  promo: {
    title: "Earn points when you trade",
    detail: (points: string) => `${points} points are split among traders every week.`,
    action: "See rewards",
    /** The same card while an invite is waiting on this device. */
    invited: {
      title: "You were invited to NoirWire Points",
      detail: (boost: number, weeks: number) =>
        `Join with your invite and your trading score gets a ${boost}% boost for your first ${weeks} weeks.`,
      action: "Join now",
    },
  },
  /**
   * How many members have earned points in the running week, said wherever
   * being early is worth saying. The count is of members with a trade
   * credited, not of everyone who traded, and the lines say exactly that.
   * None of them says who gets the points: a week is split between every
   * member who earns in it. Which line applies is chosen by the count
   * (`rewardsEarlyLine`); `count` and `points` come formatted.
   */
  early: {
    nobody: (points: string) =>
      `No member has earned points yet this week. All ${points} points are still open.`,
    one: "Only 1 member has earned points this week.",
    few: (count: string) => `Only ${count} members have earned points this week.`,
    many: (count: string) => `${count} members have earned points this week.`,
  },
  /** The home screen's card for a wallet that has joined: bring someone in, or what unlocks that. */
  inviteCard: {
    active: {
      title: "Bring a friend into Points",
      detail: (share: number, boost: number, weeks: number) =>
        `${share}% of their trading score counts for you too. They get a ${boost}% boost for their first ${weeks} weeks.`,
      action: "Share my invite",
    },
    locked: {
      title: "One trade unlocks your invite",
      detail: (share: number) =>
        `After your first trade you get an invite link. ${share}% of your friends' trading score counts for you too.`,
      action: "See rewards",
    },
  },
  /** What a member sends to bring someone in. Each text is whole: nothing is added around it. */
  share: {
    chat: (link: string, boost: number, weeks: number, share: number) =>
      `I joined NoirWire Points. Here is my invite: ${link}\nIf you opt in, your trading score gets a ${boost}% boost for ${weeks} weeks, and ${share}% of it counts toward mine too.`,
    /** The post's text. The link goes beside it, not in it. `split` is the sentence about the week, or empty. */
    x: (split: string, boost: number, weeks: number, share: number) =>
      `I joined NoirWire Points. ${split}Opt in with my invite and your trading score gets a ${boost}% boost for ${weeks} weeks; ${share}% of your score counts for me too.`,
    xSplit: (points: string) => `Each week, ${points} points are split by trading fees paid. `,
    shareLabel: "Share my invite",
    xLabel: "Post on X",
    copied: "Invite copied",
  },
  /** Shown where a wallet is created or restored, while an invite is waiting on this device. */
  invitedBanner: {
    title: "Someone invited you to NoirWire Points",
    detail: (boost: number, weeks: number) =>
      `Create a wallet, then join in Rewards. Your trading score gets a ${boost}% boost for your first ${weeks} weeks, and joining is optional.`,
  },
  /**
   * What there is to earn, said first to a wallet that has not joined. Its
   * title is the promo's. Every number is passed in: the season's from the
   * server, the inviting rules from the constants the scoring keeps to.
   */
  pitch: {
    split: (points: string) =>
      `${points} points are split among traders every week, by the fees each one paid.`,
    /** The split is by fees paid, not by head count, and this says no more than that. */
    fewer: "The less the others pay in fees that week, the more points yours earn.",
    season: (weeks: string) => `Season 1 runs ${weeks} weeks.`,
    /** Said first while an invite is waiting on this device. */
    invited: (boost: number, weeks: number) =>
      `Your invite gives your trading score a ${boost}% boost for your first ${weeks} weeks.`,
    invite: (share: number, boost: number, weeks: number) =>
      `Invite someone after your first trade: ${share}% of their trading score counts for you too, and they get a ${boost}% boost for their first ${weeks} weeks.`,
  },
  /** The only thing said about a token, anywhere. */
  token: "If NoirWire ever launches a token, points decide who gets it.",

  join: {
    explanation: [
      "Joining is optional.",
      "While a trade is being checked, our server sees which portfolio earned it, and does not keep that.",
      "Your points are tied to a separate key that comes from your recovery phrase.",
    ],
    inviteCode: "Invite code (optional)",
    button: "Join rewards",
    /** The button's label while the joining is under way. */
    busy: "Joining",
    inviteNotValid: "That invite code is not valid. Check it, or join without one.",
    failed: "You have not joined yet. Try again in a moment.",
  },

  points: "Points",
  week: {
    fee: "Your trade fees this week",
    share: "Estimated share of this week's points",
    ends: "This week ends",
  },
  percent: (percent: string) => `${percent}%`,
  invite: {
    code: "Your invite code",
    link: "Your invite link",
    /** The accessible names of the two copy buttons. */
    copyCode: "Copy invite code",
    copyLink: "Copy invite link",
    locked: "Your invite code unlocks after your first trade.",
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
  /** Said when the wallet has joined and its points could not be read. */
  notNow: "Your points cannot be shown right now. They are kept.",
  leave: {
    button: "Turn off on this device",
    note: "Your points are kept. Join again with the same recovery phrase to see them.",
    /** Asked before it is turned off. The note above is its body. */
    confirm: {
      title: "Turn off rewards on this device?",
      confirm: "Turn off",
      cancel: "Keep rewards on",
    },
  },
};
