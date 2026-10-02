# copy

Every string a person reads, in one place, so both apps say the same thing in the same words.

**Belongs here:** constants, and small functions that put already-formatted values into a sentence.

**Style:** say "portfolio", "funding wallet" and "trackers". Say plainly what happened and what to do next. No em dashes; three periods for an ellipsis. Never name the network's own currency where the cost is paid in USDC.

**May import:** types from `domain/`.

**Must never import:** anything else. Formatting numbers is `domain/format.ts`'s job; choosing which string applies is `presentation/`'s. `application/` never imports this folder.
