/** The Rewards screen: points for trades, for a wallet that chose to join. */
export const rewardsCopy = {
  /** The screen's title, and what the app's navigation calls it. */
  title: "Rewards",
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
  /** Which member someone is, by the order of joining. `number` comes formatted. */
  member: {
    label: "Member",
    value: (number: string) => `#${number}`,
    line: (number: string) => `Member #${number}`,
  },
  /**
   * Which member someone would be if they joined now. The count is as old
   * as the moment it was read, so both lines say "join now" and neither
   * promises the number. `members` is "1 member" or "1,500 members".
   */
  next: {
    first: "Join now and you are member #1.",
    after: (members: string, next: string) =>
      `${members} so far. Join now and you are member #${next}.`,
  },
  /** The home screen's card for a wallet that has joined: bring someone in, or what unlocks that. */
  inviteCard: {
    active: {
      title: "Bring a friend into Points",
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
    opening: (number: string) => `I am member #${number} of NoirWire Points.`,
    chat: (opening: string, link: string, boost: number, weeks: number, share: number) =>
      `${opening} Here is my invite: ${link}\nIf you opt in, your trading score gets a ${boost}% boost for ${weeks} weeks, and ${share}% of it counts toward mine too.`,
    /** The post's text. The link goes beside it, not in it. `split` is the sentence about the week, or empty. */
    x: (opening: string, split: string, boost: number, weeks: number, share: number) =>
      `${opening} ${split}Opt in with my invite and your trading score gets a ${boost}% boost for ${weeks} weeks; ${share}% of your score counts for me too.`,
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
      `After your first trade you get an invite link: ${share}% of each invited person's trading score counts for you too, and they get a ${boost}% boost for their first ${weeks} weeks.`,
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
  /** Said when the wallet has joined and its points could not be read. */
  notNow: "Your points cannot be shown right now. They are kept.",
};
