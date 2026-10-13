// The test object every spec imports. Signed in by default: each worker logs in through the UI
// once, on first use, and keeps the session as an in-memory storageState (no token file on
// disk). Specs opt out with test.use({ anonymous: true }).
import { test as base, expect } from "@playwright/test";
import { ANONYMOUS, loginThroughUi, type StorageState } from "./helpers/auth";
import { documentationIp } from "./helpers/throttle";

interface Options {
  /** Start without a session (login and logout specs). */
  anonymous: boolean;
  /**
   * Send a random x-forwarded-for, so the test's login attempts land in their own throttle
   * bucket. Only for anonymous login specs: the header also goes to cross-origin requests.
   */
  ownThrottleBucket: boolean;
}

interface WorkerFixtures {
  signedInState: () => Promise<StorageState>;
}

export const test = base.extend<Options, WorkerFixtures>({
  anonymous: [false, { option: true }],
  ownThrottleBucket: [false, { option: true }],

  signedInState: [
    async ({ browser }, use, workerInfo) => {
      let state: Promise<StorageState> | null = null;
      await use(() => {
        state ??= (async () => {
          const context = await browser.newContext({
            baseURL: workerInfo.project.use.baseURL,
          });
          try {
            await loginThroughUi(await context.newPage());
            return await context.storageState();
          } finally {
            await context.close();
          }
        })();
        return state;
      });
    },
    { scope: "worker" },
  ],

  storageState: async ({ anonymous, signedInState }, use) => {
    await use(anonymous ? ANONYMOUS : await signedInState());
  },

  extraHTTPHeaders: async ({ extraHTTPHeaders, ownThrottleBucket }, use) => {
    await use(
      ownThrottleBucket
        ? { ...extraHTTPHeaders, "x-forwarded-for": documentationIp() }
        : extraHTTPHeaders,
    );
  },
});

export { expect };
