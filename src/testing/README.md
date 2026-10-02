# testing

In-memory implementations of every port in `platform.ts`, for tests in this package and in the apps. Exported as `@noirwire/shared/testing`.

```ts
import { installPlatform } from "@noirwire/shared/platform";
import { memoryPlatform, memoryStorage } from "@noirwire/shared/testing";

const storage = memoryStorage();
installPlatform(memoryPlatform({ storage }));
```

**May import:** `platform.ts` only. Nothing outside tests imports this folder.
