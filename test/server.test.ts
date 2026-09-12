/**
 * End-to-end: a real MCP client talking to createServer() over an in-memory
 * transport, backed by the mock harness.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HarnessClient } from "../src/harnessClient.js";
import { createServer } from "../src/server.js";
import { startMockHarness, type MockHarness } from "./mockHarness.js";

let harness: MockHarness;
let client: Client;

beforeEach(async () => {
  harness = await startMockHarness();
  const server = createServer(new HarnessClient(harness.url));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client?.close();
  await harness?.close();
});

const textOf = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");

describe("MCP server", () => {
  it("advertises the full tool set", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "click",
        "get_ui_tree",
        "invoke_action",
        "launch_app",
        "list_windows",
        "screenshot",
        "type",
        "wait_for",
      ].sort(),
    );
  });

  it("runs get_ui_tree", async () => {
    const res = await client.callTool({ name: "get_ui_tree", arguments: { compact: true } });
    expect(textOf(res as never)).toMatch(/window "Main"/);
  });

  it("runs click and hits the harness", async () => {
    const res = await client.callTool({ name: "click", arguments: { selector: "#save" } });
    expect(textOf(res as never)).toBe('clicked button "Save" #save');
    expect(harness.calls).toContain("POST /tap save");
  });

  it("returns an image block from screenshot", async () => {
    const res = (await client.callTool({ name: "screenshot", arguments: {} })) as {
      content: Array<{ type: string }>;
    };
    expect(res.content[0].type).toBe("image");
  });

  it("flags a bad selector as an error result", async () => {
    const res = (await client.callTool({
      name: "click",
      arguments: { selector: "#nope" },
    })) as { isError?: boolean };
    expect(res.isError).toBe(true);
  });
});
