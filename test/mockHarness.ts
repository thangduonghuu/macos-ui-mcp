/**
 * In-memory Node HTTP server implementing the harness contract from
 * src/contract.ts. Used by the test suite instead of a real macOS app.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { UINode, Window } from "../src/contract.js";

/** 1x1 transparent PNG. */
export const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

export interface DelayedNode {
  afterMs: number;
  parentId: string;
  node: UINode;
}

export interface MockOptions {
  window?: Window;
  tree?: UINode;
  /** A node that is absent at first and inserted after `afterMs`. For wait_for tests. */
  delayedNode?: DelayedNode;
  /** Force POST endpoints to answer { ok: false }. */
  failActions?: boolean;
}

export interface MockHarness {
  url: string;
  close: () => Promise<void>;
  /** Request log: "GET /tree", "POST /tap {node}", ... */
  readonly calls: string[];
  /** Current tree (mutated by /setText and delayedNode). */
  readonly tree: UINode;
}

const defaultWindow: Window = {
  id: "win-1",
  title: "Main",
  key: true,
  frame: { x: 0, y: 0, width: 480, height: 320 },
};

const defaultTree = (): UINode => ({
  id: "root",
  role: "window",
  label: "Main",
  frame: { x: 0, y: 0, width: 480, height: 320 },
  children: [
    { id: "title", role: "text", label: "Welcome", value: "Welcome" },
    { id: "email", role: "textfield", label: "Email", value: "", enabled: true },
    { id: "password", role: "textfield", label: "Password", value: "", enabled: true },
    { id: "save", role: "button", label: "Save", enabled: true },
    { id: "cancel", role: "button", label: "Cancel", enabled: true },
  ],
});

function findById(node: UINode, id: string): UINode | undefined {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return undefined;
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startMockHarness(opts: MockOptions = {}): Promise<MockHarness> {
  const window = opts.window ?? defaultWindow;
  const tree = opts.tree ?? defaultTree();
  const calls: string[] = [];
  let delayTimer: NodeJS.Timeout | undefined;

  if (opts.delayedNode) {
    const { afterMs, parentId, node } = opts.delayedNode;
    delayTimer = setTimeout(() => {
      const parent = findById(tree, parentId);
      if (parent) (parent.children ??= []).push(node);
    }, afterMs);
    delayTimer.unref?.();
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const send = (code: number, body: unknown, contentType = "application/json") => {
      const payload =
        contentType === "application/json" ? JSON.stringify(body) : (body as Buffer);
      res.writeHead(code, { "content-type": contentType });
      res.end(payload);
    };

    try {
      if (method === "GET" && url.pathname === "/windows") {
        calls.push("GET /windows");
        return send(200, { windows: [window] });
      }

      if (method === "GET" && url.pathname === "/tree") {
        calls.push(`GET /tree${url.search}`);
        return send(200, { window, tree });
      }

      if (method === "GET" && url.pathname === "/snapshot") {
        calls.push(`GET /snapshot${url.search}`);
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(PNG_1x1);
      }

      if (method === "POST" && url.pathname === "/tap") {
        const { node } = JSON.parse((await readBody(req)) || "{}");
        calls.push(`POST /tap ${node}`);
        if (opts.failActions) return send(200, { ok: false, detail: "forced failure" });
        const target = findById(tree, node);
        return send(200, target ? { ok: true } : { ok: false, detail: "no such node" });
      }

      if (method === "POST" && url.pathname === "/setText") {
        const { node, text } = JSON.parse((await readBody(req)) || "{}");
        calls.push(`POST /setText ${node}`);
        if (opts.failActions) return send(200, { ok: false, detail: "forced failure" });
        const target = findById(tree, node);
        if (!target) return send(200, { ok: false, detail: "no such node" });
        target.value = text;
        return send(200, { ok: true });
      }

      if (method === "POST" && url.pathname === "/action") {
        const { name } = JSON.parse((await readBody(req)) || "{}");
        calls.push(`POST /action ${name}`);
        return send(200, opts.failActions ? { ok: false, detail: "forced failure" } : { ok: true });
      }

      return send(404, { error: "not found" });
    } catch (err) {
      return send(500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    tree,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (delayTimer) clearTimeout(delayTimer);
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
