/**
 * Pure tool implementations. No dependency on the MCP SDK so they can be
 * unit-tested directly against a mock harness.
 */
import type { UINode } from "./contract.js";
import { HarnessClient } from "./harnessClient.js";
import { findAll, findNode, parseSelector } from "./selector.js";

export interface ToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
}

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

export async function listWindows(client: HarnessClient): Promise<ToolResult> {
  const { windows } = await client.windows();
  return ok(JSON.stringify(windows, null, 2));
}

export async function getUiTree(
  client: HarnessClient,
  args: { window?: string; compact?: boolean } = {},
): Promise<ToolResult> {
  const { window, tree } = await client.tree(args.window);
  if (args.compact) {
    return ok(`window ${JSON.stringify(window.title)} (${window.id})\n${outline(tree)}`);
  }
  return ok(JSON.stringify({ window, tree }, null, 2));
}

export async function screenshot(
  client: HarnessClient,
  args: { window?: string; selector?: string } = {},
): Promise<ToolResult> {
  let nodeId: string | undefined;
  if (args.selector) {
    const resolved = await resolveOne(client, args.selector, args.window);
    if ("error" in resolved) return fail(resolved.error);
    nodeId = resolved.node.id;
  }
  const png = await client.snapshot({ windowId: args.window, nodeId });
  return {
    content: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }],
  };
}

export async function click(
  client: HarnessClient,
  args: { selector: string; window?: string },
): Promise<ToolResult> {
  const resolved = await resolveOne(client, args.selector, args.window);
  if ("error" in resolved) return fail(resolved.error);
  const res = await client.tap(resolved.node.id);
  return res.ok
    ? ok(`clicked ${describe(resolved.node)}`)
    : fail(`tap failed on ${resolved.node.id}: ${res.detail ?? "unknown error"}`);
}

export async function type(
  client: HarnessClient,
  args: { selector: string; text: string; window?: string },
): Promise<ToolResult> {
  const resolved = await resolveOne(client, args.selector, args.window);
  if ("error" in resolved) return fail(resolved.error);
  const res = await client.setText(resolved.node.id, args.text);
  return res.ok
    ? ok(`set text of ${describe(resolved.node)} to ${JSON.stringify(args.text)}`)
    : fail(`setText failed on ${resolved.node.id}: ${res.detail ?? "unknown error"}`);
}

export async function invokeAction(
  client: HarnessClient,
  args: { name: string },
): Promise<ToolResult> {
  const res = await client.action(args.name);
  return res.ok
    ? ok(`ran action ${JSON.stringify(args.name)}`)
    : fail(`action ${JSON.stringify(args.name)} failed: ${res.detail ?? "unknown error"}`);
}

export async function waitFor(
  client: HarnessClient,
  args: { selector: string; window?: string; timeoutMs?: number; pollMs?: number },
): Promise<ToolResult> {
  const timeoutMs = args.timeoutMs ?? 5000;
  const pollMs = args.pollMs ?? 100;
  const sel = parseSelector(args.selector);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const { tree } = await client.tree(args.window);
    if (findNode(tree, sel)) return ok(`found ${args.selector}`);
    if (Date.now() >= deadline) {
      return fail(`timed out after ${timeoutMs}ms waiting for ${args.selector}`);
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}

// --- helpers -----------------------------------------------------------------

type Resolved = { node: UINode } | { error: string };

async function resolveOne(
  client: HarnessClient,
  selector: string,
  windowId: string | undefined,
): Promise<Resolved> {
  const sel = parseSelector(selector);
  const { tree } = await client.tree(windowId);
  const hits = findAll(tree, sel);
  if (hits.length === 0) return { error: `No node matches selector: ${selector}` };
  if (hits.length > 1) {
    const ids = hits.map((n) => n.id).join(", ");
    return { error: `Selector ${selector} is ambiguous (${hits.length} matches: ${ids})` };
  }
  return { node: hits[0] };
}

function describe(node: UINode): string {
  const parts = [node.role];
  if (node.label) parts.push(JSON.stringify(node.label));
  parts.push(`#${node.id}`);
  return parts.join(" ");
}

function outline(node: UINode, depth = 0): string {
  const pad = "  ".repeat(depth);
  const bits = [node.role];
  if (node.label) bits.push(JSON.stringify(node.label));
  if (node.value !== undefined) bits.push(`= ${JSON.stringify(node.value)}`);
  bits.push(`#${node.id}`);
  const line = `${pad}${bits.join(" ")}`;
  const kids = (node.children ?? []).map((c) => outline(c, depth + 1));
  return [line, ...kids].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
