/**
 * End-to-end against a real React Native app (examples/expo-rn, Expo 57 / RN 0.86, New
 * Architecture) with the harness embedded by expo-plugin/. Starts Metro, installs the
 * Debug build on the booted simulator via launch_app, then drives RN's own views:
 * Pressable + Text, TextInput, ScrollView.
 *
 * Skipped unless E2E_RN=1. Build the app first (see examples/expo-rn/README.md):
 *   npm run test:e2e:rn
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UINode } from "../src/contract.js";
import { HarnessClient } from "../src/harnessClient.js";
import * as tools from "../src/tools.js";

const PORT = 8794; // set in examples/expo-rn/app.json
// Not 8081, so it can't collide with another project's Metro. The app is pointed at it
// through RCTBundleURLProvider's RCT_jsLocation user default.
const METRO_PORT = 8095;
const BUNDLE_ID = "dev.app-mcp.expo-rn-example";
const EXAMPLE = fileURLToPath(new URL("../examples/expo-rn", import.meta.url));
const APP = `${EXAMPLE}/ios/build/Build/Products/Debug-iphonesimulator/ExpoRnExample.app`;
const enabled = process.env.E2E_RN === "1";

const textOf = (r: tools.ToolResult) =>
  r.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("");

function find(node: UINode, pred: (n: UINode) => boolean): UINode | undefined {
  if (pred(node)) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, pred);
    if (hit) return hit;
  }
  return undefined;
}
const byId = (id: string) => (n: UINode) => n.id === id;

async function waitForMetro(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${METRO_PORT}/status`);
      if ((await res.text()).includes("running")) return;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) throw new Error(`Metro did not start on port ${METRO_PORT}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe.skipIf(!enabled)("e2e: real React Native app on the iOS Simulator", () => {
  const client = new HarnessClient(`http://127.0.0.1:${PORT}`);
  let metro: ChildProcess;

  beforeAll(async () => {
    if (!existsSync(APP)) throw new Error(`${APP} not found — see examples/expo-rn/README.md`);
    metro = spawn("npx", ["expo", "start", "--port", String(METRO_PORT)], {
      cwd: EXAMPLE,
      // vitest sets NODE_ENV=test, which the Expo CLI refuses to start under.
      env: { ...process.env, CI: "1", NODE_ENV: "development" },
      stdio: "ignore",
      detached: true,
    });
    await waitForMetro(60_000);
    execFileSync("xcrun", [
      "simctl", "spawn", "booted", "defaults", "write", BUNDLE_ID, "RCT_jsLocation", `localhost:${METRO_PORT}`,
    ]);
    const r = await tools.launchApp(client, { path: APP, simulator: "booted", waitMs: 60_000 });
    if (r.isError) throw new Error(textOf(r));
    // The harness is up before JS has rendered; wait for the first screen.
    const ready = await tools.waitFor(client, { selector: "#email", timeoutMs: 120_000, pollMs: 500 });
    if (ready.isError) throw new Error(textOf(ready));
  }, 200_000);

  afterAll(() => {
    try {
      if (metro?.pid) process.kill(-metro.pid, "SIGTERM");
    } catch {
      // already exited
    }
  });

  it("finds RN views: testID as id, <Text> as label, Pressable labelled by its Text", async () => {
    const { tree } = await client.tree();
    expect(find(tree, byId("status"))?.label).toBe("Typed: ");
    expect(find(tree, byId("item-1"))?.label).toBe("Item 1");
    expect(find(tree, byId("item-30"))).toBeUndefined(); // scrolled away
    expect(find(tree, (n) => n.label === "Tiếp")).toBeDefined();
  });

  it("type updates JS state through onChangeText", async () => {
    const r = await tools.type(client, { selector: "#email", text: "Xin chào" });
    expect(r.isError).toBeFalsy();
    const res = await tools.waitFor(client, { selector: '"Typed: Xin chào"', timeoutMs: 3000 });
    expect(res.isError).toBeFalsy();
  });

  it("scroll reveals the bottom of the ScrollView", async () => {
    for (let i = 0; i < 10; i++) {
      if (find((await client.tree()).tree, byId("item-30"))) break;
      expect((await tools.scroll(client, { selector: "#list", direction: "down" })).isError).toBeFalsy();
    }
    expect(find((await client.tree()).tree, byId("item-30"))).toBeDefined();
  }, 30_000);

  it('click("Tiếp") presses the Pressable with a real touch and changes screen', async () => {
    const r = await tools.click(client, { selector: '"Tiếp"' });
    expect(r.isError).toBeFalsy();
    const res = await tools.waitFor(client, { selector: "#screen2-title", timeoutMs: 3000 });
    expect(res.isError).toBeFalsy();
  });

  it("tap_at presses by coordinates", async () => {
    const back = find((await client.tree()).tree, byId("back"));
    if (!back?.frame) throw new Error("no #back");
    const { x, y, width, height } = back.frame;
    expect((await tools.tapAt(client, { x: x + width / 2, y: y + height / 2 })).isError).toBeFalsy();
    const res = await tools.waitFor(client, { selector: "#email", timeoutMs: 3000 });
    expect(res.isError).toBeFalsy();
  });
});
