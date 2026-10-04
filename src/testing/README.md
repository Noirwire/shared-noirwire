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

`installTestPlatform()` is the one call a consumer's test setup needs: it installs every port in memory and a `fakeSession()` in place of the server's session routes, so nothing reaches the network to start with. `fakeApi(routes)` then stands in for the server, by path, until `restore()`:

```ts
import { fakeApi, installTestPlatform } from "@noirwire/shared/testing";

const { session } = installTestPlatform();
const api = fakeApi({
  "/v1/prices": () => ({ prices: {} }),
  "POST /v1/relayer": (call) => ({ result: { fee_in_token: 4000 } }),
  "/v1/jupiter/*": () => new Response("busy", { status: 429 }),
});
// ... the code under test ...
api.callsTo("/v1/prices"); // what was asked, with its headers and body
api.restore();
```

A route is a path, optionally with its method in front or a `*` at its end; it answers a `Response`, or a value sent as JSON. A request no route answers throws and names itself. Every request carries `Bearer test-token-1`; a 401 from a route moves the fake session on to `test-token-2`, as a renewal would. `memorySessionStore()` is the session store in memory, for a test of the real session.

**May import:** `platform.ts`, and `infrastructure/` for the signing entry point and the session. Nothing outside tests imports this folder.
