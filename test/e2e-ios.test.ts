/**
 * End-to-end on the iOS Simulator: the real TypeScript tools driving the real Swift
 * harness inside showcase-ios/, a UIKit app shaped like React Native (plain-UIView
 * "Pressable" with a Text inside, one root gesture recognizer, keyboard-path-only
 * text state, a scroll view).
 *
 * Skipped unless E2E_IOS=1. Needs a booted simulator:
 *   npm run test:e2e:ios
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { UINode } from "../src/contract.js";
import { HarnessClient, isPng } from "../src/harnessClient.js";
import * as tools from "../src/tools.js";

const PORT = 8793;
const APP = fileURLToPath(new URL("../showcase-ios/build/ShowcaseIOS.app", import.meta.url));
const enabled = process.env.E2E_IOS === "1";

const textOf = (r: tools.ToolResult) =>
  r.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("");

function findById(node: UINode, id: string): UINode | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return undefined;
}

describe.skipIf(!enabled)("e2e: real harness in an RN-shaped iOS Simulator app", () => {
  const client = new HarnessClient(`http://127.0.0.1:${PORT}`);

  beforeAll(async () => {
    if (!existsSync(APP)) throw new Error(`${APP} not found — run: ./showcase-ios/build.sh`);
    const r = await tools.launchApp(client, {
      path: APP,
      simulator: "booted",
      env: { SHOWCASE_PORT: String(PORT) },
      waitMs: 30_000,
    });
    if (r.isError) throw new Error(textOf(r));
  }, 60_000);

  it("lists only on-screen views: the list's lower rows are absent", async () => {
    const { tree } = await client.tree();
    expect(findById(tree, "next")?.label).toBe("Tiếp");
    expect(findById(tree, "row-1")).toBeDefined();
    expect(findById(tree, "row-30")).toBeUndefined();
  });

  it("type goes through the keyboard path (delegate + editingChanged)", async () => {
    const r = await tools.type(client, { selector: "#email", text: "Xin chào" });
    expect(r.isError).toBeFalsy();
    const { tree } = await client.tree();
    expect(findById(tree, "status")?.label).toBe("Typed: Xin chào");
  });

  it("scroll drags the list until the last row shows", async () => {
    for (let i = 0; i < 10; i++) {
      if (findById((await client.tree()).tree, "row-30")) break;
      expect((await tools.scroll(client, { direction: "down" })).isError).toBeFalsy();
    }
    expect(findById((await client.tree()).tree, "row-30")).toBeDefined();
  }, 30_000);

  it('click("Tiếp") taps the Pressable with a real touch and changes screen', async () => {
    const r = await tools.click(client, { selector: '"Tiếp"' });
    expect(textOf(r)).toBe('clicked group "Tiếp" #next');
    expect((await tools.waitFor(client, { selector: "#screen2-title", timeoutMs: 2000 })).isError).toBeFalsy();
    // Screen 1 stays in the hierarchy underneath, now covered.
    expect(findById((await client.tree()).tree, "next")?.hittable).toBe(false);
    const again = await tools.click(client, { selector: "#next" });
    expect(textOf(again)).toMatch(/covered by/);
  });

  it("invoke_action and a UIControl click still work", async () => {
    expect((await tools.invokeAction(client, { name: "reset" })).isError).toBeFalsy();
    const { tree } = await client.tree();
    expect(findById(tree, "screen2-title")).toBeUndefined();
    expect(findById(tree, "status")?.label).toBe("Welcome");
    expect((await tools.click(client, { selector: 'Button "Reset"' })).isError).toBeFalsy();
  });

  it("tap_at hits the Pressable by coordinates", async () => {
    const frame = findById((await client.tree()).tree, "next")?.frame;
    if (!frame) throw new Error("no frame for #next");
    const r = await tools.tapAt(client, { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });
    expect(r.isError).toBeFalsy();
    expect(findById((await client.tree()).tree, "screen2-title")).toBeDefined();
    await tools.invokeAction(client, { name: "reset" });
  });

  it("screenshot renders in-process", async () => {
    const block = (await tools.screenshot(client, {})).content[0];
    if (block.type !== "image") throw new Error("expected image");
    const png = Buffer.from(block.data, "base64");
    expect(isPng(png)).toBe(true);
    expect(png.byteLength).toBeGreaterThan(5000);
  });
});
