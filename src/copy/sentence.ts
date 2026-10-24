/** `text` with its first letter capitalised, for a name that starts a sentence. */
export const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
