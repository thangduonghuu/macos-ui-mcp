/**
 * End-to-end: the real TypeScript tools driving the real Swift harness inside a
 * live AppKit app (showcase/). Proves the goals with Screen Recording OFF.
 *
 * Skipped unless E2E=1 and the showcase binary has been built:
 *   npm run test:e2e
 *
 * Requires a logged-in macOS GUI session (AppKit needs the window server).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UINode } from "../src/contract.js";
import { HarnessClient, isPng } from "../src/harnessClient.js";
import * as tools from "../src/tools.js";

const PORT = 8791;
const BIN = fileURLToPath(new URL("../showcase/.build/debug/Showcase", import.meta.url));
const enabled = process.env.E2E === "1";

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

async function waitForHarness(client: HarnessClient, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await client.windows();
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error("harness did not come up in time");
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

describe.skipIf(!enabled)("e2e: real harness in a live AppKit app", () => {
  let app: ChildProcess;
  const client = new HarnessClient(`http://127.0.0.1:${PORT}`);

  beforeAll(async () => {
    if (!existsSync(BIN)) {
      throw new Error(`${BIN} not found — run: swift build --package-path showcase`);
    }
    app = spawn(BIN, [], {
      env: { ...process.env, SHOWCASE_PORT: String(PORT) },
      stdio: "inherit",
    });
    await waitForHarness(client, 15_000);
  }, 20_000);

  afterAll(async () => {
    app?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  });

  it("G1: get_ui_tree exposes the controls with stable ids", async () => {
    const out = textOf(await tools.getUiTree(client, { compact: true }));
    expect(out).toContain("button \"Save\" #save");
    expect(out).toContain("#email");
    expect(out).toContain("#status");
  });

  it("G2: screenshot is a real in-process PNG render (Screen Recording off)", async () => {
    const res = await tools.screenshot(client, {});
    const block = res.content[0];
    expect(block.type).toBe("image");
    if (block.type !== "image") throw new Error("expected image");
    const png = Buffer.from(block.data, "base64");
    expect(isPng(png)).toBe(true);
    expect(png.byteLength).toBeGreaterThan(1000); // a 360x200 window, not a stub
  });

  it("G3: type + click drive the UI and the tree reflects it", async () => {
    expect((await tools.type(client, { selector: "#email", text: "e2e@example.com" })).isError).toBeFalsy();
    expect((await tools.click(client, { selector: "#save" })).isError).toBeFalsy();

    const { tree } = await client.tree();
    expect(findById(tree, "status")?.label).toBe("Saved: e2e@example.com");
    expect(findById(tree, "email")?.value).toBe("e2e@example.com");
  });

  it("invoke_action runs a registered hook", async () => {
    expect((await tools.invokeAction(client, { name: "reset" })).isError).toBeFalsy();
    const { tree } = await client.tree();
    expect(findById(tree, "status")?.label).toBe("Welcome");
    expect(findById(tree, "email")?.value).toBe("");
  });

  it("wait_for resolves against the live tree", async () => {
    const res = await tools.waitFor(client, { selector: "#save", timeoutMs: 2000 });
    expect(res.isError).toBeFalsy();
  });
});
