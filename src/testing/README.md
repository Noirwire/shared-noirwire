# testing

In-memory implementations of every port in `platform.ts`, for tests in this package and in the apps. `memoryVault` keeps the real contract: updates of one key are serialised by the lock, it can be made `unavailable` to fail every call, and `writeFromElsewhere` stands for another tab. Exported as `@noirwire/shared/testing`.

```ts
import { installPlatform } from "@noirwire/shared/platform";
import { memoryPlatform, memoryVault } from "@noirwire/shared/testing";

const vault = memoryVault();
installPlatform(memoryPlatform({ vault }));
```

`signAsClient` is for a test's stand-in chain client: it signs a transaction through the installed signing guard, exactly as the real clients do before they send, so a fake "send" is held to the same rules (a reservation first, the network checked, nothing signed once locked). `unsignedTransaction` makes an empty one to sign.

```ts
import { signAsClient } from "@noirwire/shared/testing";

const fakeSend = async (owner: Keypair, stillUnlocked: () => boolean) => {
  await signAsClient(owner, stillUnlocked);
  return "fake-signature";
};
```

**May import:** `platform.ts`, and `infrastructure/` for the signing entry point only. Nothing outside tests imports this folder.
