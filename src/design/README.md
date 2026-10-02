# design

Design tokens and pure drawing maths.

- `tokens.ts` is the single source for colours, radii, spacing and the type scale. The names are those of the `@theme` block in the web app's stylesheet. `tests/webTokens.test.ts` compares the two whenever the web app is checked out beside this repository.
- `chartPath.ts` turns a series of values into SVG line and area paths.

**May import:** nothing of ours.
