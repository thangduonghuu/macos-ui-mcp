#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HarnessClient } from "./harnessClient.js";
import { createServer } from "./server.js";

const baseUrl = process.env.MACOS_UI_MCP_HARNESS_URL ?? "http://127.0.0.1:8787";

const server = createServer(new HarnessClient(baseUrl));
await server.connect(new StdioServerTransport());

// stderr only — stdout is the MCP transport.
console.error(`macos-ui-mcp: bridging MCP <-> harness at ${baseUrl}`);
