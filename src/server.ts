import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { HarnessClient } from "./harnessClient.js";
import * as tools from "./tools.js";

const wrap =
  <A>(fn: (client: HarnessClient, args: A) => Promise<tools.ToolResult>, client: HarnessClient) =>
  async (args: A): Promise<CallToolResult> => {
    try {
      return (await fn(client, args)) as CallToolResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
    }
  };

export function createServer(client: HarnessClient): McpServer {
  const server = new McpServer({ name: "macos-ui-mcp", version: "0.1.0" });

  server.registerTool(
    "list_windows",
    {
      title: "List windows",
      description: "List the app's on-screen windows (id, title, key, frame).",
      inputSchema: {},
    },
    wrap((c) => tools.listWindows(c), client),
  );

  server.registerTool(
    "get_ui_tree",
    {
      title: "Get UI tree",
      description:
        "Dump the semantic view tree of a window as JSON: roles, labels, values, enabled/focused state, frames, and stable ids. Use `compact` for a terse outline.",
      inputSchema: {
        window: z.string().optional().describe("Window id; defaults to the key window."),
        compact: z.boolean().optional().describe("Return an indented outline instead of full JSON."),
      },
    },
    wrap(tools.getUiTree, client),
  );

  server.registerTool(
    "screenshot",
    {
      title: "Screenshot",
      description:
        "Render a window (or a single node via `selector`) to PNG. Rendered in-process by the app — no Screen Recording permission.",
      inputSchema: {
        window: z.string().optional().describe("Window id; defaults to the key window."),
        selector: z
          .string()
          .optional()
          .describe('Limit the capture to one node. e.g. "#save", Button "Save".'),
      },
    },
    wrap(tools.screenshot, client),
  );

  server.registerTool(
    "click",
    {
      title: "Click",
      description:
        'Tap a view matched by selector. Selector grammar: "#id" | Role "Label" | "Label" | Role.',
      inputSchema: {
        selector: z.string().describe('e.g. "#save", Button "Save".'),
        window: z.string().optional(),
      },
    },
    wrap(tools.click, client),
  );

  server.registerTool(
    "type",
    {
      title: "Type",
      description: "Set the text value of a field matched by selector.",
      inputSchema: {
        selector: z.string().describe('e.g. "#email", Textfield "Email".'),
        text: z.string(),
        window: z.string().optional(),
      },
    },
    wrap(tools.type, client),
  );

  server.registerTool(
    "invoke_action",
    {
      title: "Invoke action",
      description:
        "Trigger a named action hook registered by the app via AppMCP.registerAction(name, …).",
      inputSchema: { name: z.string() },
    },
    wrap(tools.invokeAction, client),
  );

  server.registerTool(
    "wait_for",
    {
      title: "Wait for",
      description: "Poll the UI tree until a selector appears, or time out.",
      inputSchema: {
        selector: z.string(),
        window: z.string().optional(),
        timeoutMs: z.number().optional().describe("Default 5000."),
        pollMs: z.number().optional().describe("Default 100."),
      },
    },
    wrap(tools.waitFor, client),
  );

  return server;
}
