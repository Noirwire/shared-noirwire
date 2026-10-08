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
  },
  /**
   * What there is to earn, said first to a wallet that has not joined. Its
   * title is the promo's. Every number is passed in: the season's from the
   * server, the inviting rules from the constants the scoring keeps to.
   */
  pitch: {
    split: (points: string) =>
      `${points} points are split among traders every week, by the fees each one paid.`,
    fewer: "Fewer traders that week means a bigger share for you.",
    season: (weeks: string) => `Season 1 runs ${weeks} weeks.`,
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
