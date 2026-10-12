import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/session", () => ({ requireSession: async () => ({ userId: "u" }) }));
vi.mock("@/components/shell/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/settings/SettingsNav", () => ({ SettingsNav: () => null }));

const { Toaster } = await import("@/components/ui/sonner");
const { default: AppLayout } = await import("./layout");
const { default: SettingsLayout } = await import("./installningar/layout");

/** Every element of a tree that is of `type` (the tree is not rendered, only walked). */
function findAll(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<Record<string, unknown>>;
    if (el.type === type) out.push(el);
    out.push(...findAll(el.props.children as ReactNode, type));
  });
  return out;
}

describe("app layouts", () => {
  it("mount exactly one light toaster, in the app layout", async () => {
    const app = await AppLayout({ children: "sida" });
    const toasters = findAll(app, Toaster);
    expect(toasters).toHaveLength(1);
    expect(toasters[0]?.props.theme).toBe("light");
    const settings = await SettingsLayout({ children: "inställningar" });
    expect(findAll(settings, Toaster)).toHaveLength(0);
  });
});
