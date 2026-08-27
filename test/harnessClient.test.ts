import { afterEach, describe, expect, it } from "vitest";
import { HarnessClient, HarnessError, isPng } from "../src/harnessClient.js";
import { startMockHarness, type MockHarness } from "./mockHarness.js";

let harness: MockHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function client(): Promise<HarnessClient> {
  harness = await startMockHarness();
  return new HarnessClient(harness.url);
}

describe("HarnessClient", () => {
  it("lists windows", async () => {
    const c = await client();
    const { windows } = await c.windows();
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ id: "win-1", title: "Main", key: true });
  });

  it("fetches the key window tree by default", async () => {
    const c = await client();
    const { window, tree } = await c.tree();
    expect(window.id).toBe("win-1");
    expect(tree.id).toBe("root");
    expect(tree.children?.map((n) => n.id)).toContain("save");
  });

  it("passes the window id as a query param", async () => {
    const c = await client();
    await c.tree("win-1");
    expect(harness.calls).toContain("GET /tree?window=win-1");
  });

  it("returns a PNG buffer from snapshot", async () => {
    const c = await client();
    const png = await c.snapshot();
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(isPng(png)).toBe(true);
  });

  it("taps an existing node", async () => {
    const c = await client();
    expect(await c.tap("save")).toEqual({ ok: true });
    expect(harness.calls).toContain("POST /tap save");
  });

  it("reports a failed tap on an unknown node", async () => {
    const c = await client();
    expect(await c.tap("ghost")).toMatchObject({ ok: false });
  });

  it("setText mutates the tree", async () => {
    const c = await client();
    await c.setText("email", "a@b.com");
    const { tree } = await c.tree();
    expect(tree.children?.find((n) => n.id === "email")?.value).toBe("a@b.com");
  });

  it("wraps an unreachable harness in HarnessError", async () => {
    const throwing = new HarnessClient("http://127.0.0.1:9", () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(throwing.windows()).rejects.toBeInstanceOf(HarnessError);
  });

  it("wraps an HTTP error status in HarnessError", async () => {
    const five00 = new HarnessClient("http://x", async () => new Response("nope", { status: 500 }));
    await expect(five00.windows()).rejects.toThrow(/HTTP 500/);
  });
});
