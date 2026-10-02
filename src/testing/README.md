# testing

In-memory implementations of every port in `platform.ts`, for tests in this package and in the apps. `memoryVault` keeps the real contract: updates of one key are serialised by the lock, it can be made `unavailable` to fail every call, and `writeFromElsewhere` stands for another tab. Exported as `@noirwire/shared/testing`.

```ts
import { installPlatform } from "@noirwire/shared/platform";
import { memoryPlatform, memoryVault } from "@noirwire/shared/testing";

const vault = memoryVault();
installPlatform(memoryPlatform({ vault }));
```

**May import:** `platform.ts` only. Nothing outside tests imports this folder.
