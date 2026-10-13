// The test object every spec imports. Signed in by default: each worker logs in through the UI
// once, on first use, and keeps the session as an in-memory storageState (no token file on
// disk). Specs opt out with test.use({ anonymous: true }). Every test fails on a
// Content-Security-Policy violation in any page of its browser context.
import { test as base, expect } from "@playwright/test";
import { ANONYMOUS, loginThroughUi, type StorageState } from "./helpers/auth";
import { formatCspViolations, recordCspViolations } from "./helpers/csp";
import { frozenStandardReport } from "./helpers/reports";
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
  /** Id of the shared frozen standard report, frozen on first use when the database has none. */
  frozenReport: () => Promise<string>;
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

  frozenReport: [
    async ({ browser, signedInState }, use, workerInfo) => {
      let id: Promise<string> | null = null;
      await use(() => {
        id ??= (async () => {
          const context = await browser.newContext({
            baseURL: workerInfo.project.use.baseURL,
            storageState: await signedInState(),
          });
          try {
            return await frozenStandardReport(await context.newPage());
          } finally {
            await context.close();
          }
        })();
        return id;
      });
    },
    { scope: "worker" },
  ],

  context: async ({ context }, use) => {
    const violations = await recordCspViolations(context);
    await use(context);
    if (violations.length > 0) throw new Error(formatCspViolations(violations));
  },

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
