import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG_ACCOUNT_GROUPS } from "@/lib/contracts/catalog";

const db = { tag: "db" };
const repo = vi.hoisted(() => ({
  discardStaleUploads: vi.fn(),
  listAccountGroups: vi.fn(),
  listDatasets: vi.fn(async () => []),
  listDimensions: vi.fn(async () => []),
  listMetricDefinitions: vi.fn(async () => []),
  listTemplates: vi.fn(async () => []),
}));
const session = vi.hoisted(() => ({ requireSession: vi.fn(async () => ({ userId: "u" })) }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/session", () => session);
vi.mock("@/lib/db/client-server", () => ({ createSupabaseServerClient: async () => db }));
vi.mock("@/lib/db/repo", () => repo);
vi.mock("@/components/import/UploadApp", () => ({ UploadApp: () => null }));

const { default: UploadPage } = await import("./page");
const { UploadApp } = await import("@/components/import/UploadApp");

/** The UploadApp element of the rendered page (null when the page shows its error state). */
function uploadApp(node: ReactNode): ReactElement<{ catalog: unknown }> | null {
  if (!isValidElement(node)) {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = uploadApp(child);
        if (found) return found;
      }
    }
    return null;
  }
  if (node.type === UploadApp) return node as ReactElement<{ catalog: unknown }>;
  return uploadApp((node.props as { children?: ReactNode }).children);
}

describe("/ladda-upp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.listAccountGroups.mockResolvedValue(CATALOG_ACCOUNT_GROUPS);
  });

  it("checks the session, discards stale staged uploads and sends the account groups", async () => {
    repo.discardStaleUploads.mockResolvedValue(2);
    const app = uploadApp(await UploadPage());
    expect(session.requireSession).toHaveBeenCalledTimes(1);
    expect(repo.discardStaleUploads).toHaveBeenCalledWith(db);
    expect(app?.props.catalog).toMatchObject({
      accountGroups: CATALOG_ACCOUNT_GROUPS.map((g) => ({
        key: g.key,
        name: g.name,
        sign: g.sign,
        ranges: g.ranges,
      })),
    });
  });

  it("still opens when the cleanup fails", async () => {
    repo.discardStaleUploads.mockRejectedValue(new Error("rpc failed"));
    expect(uploadApp(await UploadPage())).not.toBeNull();
  });
});
