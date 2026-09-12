import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { isPng, HarnessClient } from "../src/harnessClient.js";
import * as tools from "../src/tools.js";
import { startMockHarness, type MockHarness, type MockOptions } from "./mockHarness.js";

interface FakeSpawn {
  impl: (cmd: string, args: readonly string[]) => EventEmitter & { unref(): void };
  calls: Array<{ cmd: string; args: string[] }>;
  fail: (err: Error) => void;
}

function fakeSpawn(): FakeSpawn {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  let child: EventEmitter | undefined;
  return {
    calls,
    impl: (cmd, args) => {
      calls.push({ cmd, args: [...args] });
      child = new EventEmitter();
      return Object.assign(child, { unref: () => {} });
    },
    fail: (err) => child?.emit("error", err),
  };
}

let harness: MockHarness;
afterEach(() => harness?.close());

async function setup(opts?: MockOptions): Promise<HarnessClient> {
  harness = await startMockHarness(opts);
  return new HarnessClient(harness.url);
}

const textOf = (r: tools.ToolResult) =>
  r.content.map((c) => (c.type === "text" ? c.text : "")).join("");

describe("launch_app", () => {
  it("opens a .app bundle via `open` and waits for the harness", async () => {
    const c = await setup();
    const fake = fakeSpawn();
    const r = await tools.launchApp(c, { path: "/Applications/Foo.app" }, fake.impl as never);
    expect(r.isError).toBeFalsy();
    expect(fake.calls).toEqual([{ cmd: "open", args: ["/Applications/Foo.app"] }]);
    expect(textOf(r)).toMatch(/launched \/Applications\/Foo\.app; harness is up/);
  });

  it("passes extra args to `open` as --args", async () => {
    const c = await setup();
    const fake = fakeSpawn();
    await tools.launchApp(
      c,
      { path: "/Applications/Foo.app", args: ["--flag"] },
      fake.impl as never,
    );
    expect(fake.calls).toEqual([
      { cmd: "open", args: ["/Applications/Foo.app", "--args", "--flag"] },
    ]);
  });

  it("spawns a plain executable path directly", async () => {
    const c = await setup();
    const fake = fakeSpawn();
    await tools.launchApp(
      c,
      { path: "/usr/local/bin/myapp", args: ["--debug"] },
      fake.impl as never,
    );
    expect(fake.calls).toEqual([{ cmd: "/usr/local/bin/myapp", args: ["--debug"] }]);
  });

  it("surfaces a spawn error instead of waiting out the timeout", async () => {
    await setup();
    const unreachable = new HarnessClient("http://127.0.0.1:1");
    const fake = fakeSpawn();
    const promise = tools.launchApp(
      unreachable,
      { path: "/bad/path", waitMs: 5000 },
      fake.impl as never,
    );
    fake.fail(new Error("spawn ENOENT"));
    const r = await promise;
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/failed to launch \/bad\/path: spawn ENOENT/);
  });

  it("times out if the harness never comes up", async () => {
    await setup();
    const unreachable = new HarnessClient("http://127.0.0.1:1");
    const fake = fakeSpawn();
    const r = await tools.launchApp(
      unreachable,
      { path: "/bad/path", waitMs: 200, pollMs: 50 },
      fake.impl as never,
    );
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/did not become reachable within 200ms/);
  });
});

describe("list_windows / get_ui_tree", () => {
  it("lists windows as JSON text", async () => {
    const c = await setup();
    const r = await tools.listWindows(c);
    expect(textOf(r)).toContain('"title": "Main"');
  });

  it("returns the full tree as JSON", async () => {
    const c = await setup();
    const r = await tools.getUiTree(c, {});
    const parsed = JSON.parse(textOf(r));
    expect(parsed.tree.id).toBe("root");
    expect(parsed.window.id).toBe("win-1");
  });

  it("returns a compact outline", async () => {
    const c = await setup();
    const r = await tools.getUiTree(c, { compact: true });
    const out = textOf(r);
    expect(out).toMatch(/^window "Main" \(win-1\)/);
    expect(out).toContain('button "Save" #save');
  });
});

describe("screenshot", () => {
  it("returns an image block for the whole window", async () => {
    const c = await setup();
    const r = await tools.screenshot(c, {});
    expect(r.content[0].type).toBe("image");
    const block = r.content[0];
    if (block.type !== "image") throw new Error("expected image");
    expect(block.mimeType).toBe("image/png");
    expect(isPng(Buffer.from(block.data, "base64"))).toBe(true);
  });

  it("resolves a selector to a node before capturing", async () => {
    const c = await setup();
    await tools.screenshot(c, { selector: "#save" });
    expect(harness.calls).toContain("GET /snapshot?node=save");
  });

  it("errors on a selector that matches nothing", async () => {
    const c = await setup();
    const r = await tools.screenshot(c, { selector: "#nope" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/No node matches/);
  });
});

describe("click", () => {
  it("taps a uniquely matched node", async () => {
    const c = await setup();
    const r = await tools.click(c, { selector: "#save" });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toBe('clicked button "Save" #save');
    expect(harness.calls).toContain("POST /tap save");
  });

  it("rejects an ambiguous selector", async () => {
    const c = await setup();
    const r = await tools.click(c, { selector: "button" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/ambiguous \(2 matches: save, cancel\)/);
  });

  it("rejects a selector with no match", async () => {
    const c = await setup();
    const r = await tools.click(c, { selector: '#missing' });
    expect(r.isError).toBe(true);
  });

  it("surfaces a harness-side failure", async () => {
    const c = await setup({ failActions: true });
    const r = await tools.click(c, { selector: "#save" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/tap failed/);
  });
});

describe("type / invoke_action", () => {
  it("sets a field value that shows up in a later tree read", async () => {
    const c = await setup();
    const r = await tools.type(c, { selector: "#email", text: "a@b.com" });
    expect(r.isError).toBeFalsy();
    const tree = JSON.parse(textOf(await tools.getUiTree(c, {})));
    expect(tree.tree.children.find((n: { id: string }) => n.id === "email").value).toBe("a@b.com");
  });

  it("runs a named action", async () => {
    const c = await setup();
    const r = await tools.invokeAction(c, { name: "reset" });
    expect(textOf(r)).toBe('ran action "reset"');
    expect(harness.calls).toContain("POST /action reset");
  });
});

describe("wait_for", () => {
  it("returns immediately when the selector is already present", async () => {
    const c = await setup();
    const r = await tools.waitFor(c, { selector: "#save", timeoutMs: 500 });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toMatch(/found #save/);
  });

  it("resolves once a delayed node appears", async () => {
    const c = await setup({
      delayedNode: {
        afterMs: 150,
        parentId: "root",
        node: { id: "toast", role: "text", label: "Saved" },
      },
    });
    const r = await tools.waitFor(c, { selector: "#toast", timeoutMs: 2000, pollMs: 50 });
    expect(r.isError).toBeFalsy();
  });

  it("times out when the selector never appears", async () => {
    const c = await setup();
    const r = await tools.waitFor(c, { selector: "#ghost", timeoutMs: 200, pollMs: 50 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/timed out after 200ms/);
  });
});
