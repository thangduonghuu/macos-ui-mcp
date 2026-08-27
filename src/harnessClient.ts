import {
  ActionResponseSchema,
  TreeResponseSchema,
  WindowsResponseSchema,
  type ActionResponse,
  type TreeResponse,
  type WindowsResponse,
} from "./contract.js";

export class HarnessError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "HarnessError";
  }
}

type FetchLike = typeof fetch;

/** HTTP client for the in-app dev harness. One instance per MCP server process. */
export class HarnessClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.baseUrl), init);
    } catch (err) {
      throw new HarnessError(
        `Cannot reach harness at ${this.baseUrl}${path} — is the app running with the harness enabled?`,
        err,
      );
    }
    if (!res.ok) {
      throw new HarnessError(`${init?.method ?? "GET"} ${path} -> HTTP ${res.status}`);
    }
    return res;
  }

  private async json<T>(
    path: string,
    schema: { parse(x: unknown): T },
    init?: RequestInit,
  ): Promise<T> {
    const res = await this.request(path, init);
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new HarnessError(`${path} returned a non-JSON body`, err);
    }
    try {
      return schema.parse(body);
    } catch (err) {
      throw new HarnessError(`${path} returned an unexpected shape`, err);
    }
  }

  private postJson<T>(
    path: string,
    schema: { parse(x: unknown): T },
    payload: unknown,
  ): Promise<T> {
    return this.json(path, schema, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  windows(): Promise<WindowsResponse> {
    return this.json("/windows", WindowsResponseSchema);
  }

  tree(windowId?: string): Promise<TreeResponse> {
    const qs = windowId ? `?window=${encodeURIComponent(windowId)}` : "";
    return this.json(`/tree${qs}`, TreeResponseSchema);
  }

  async snapshot(opts: { windowId?: string; nodeId?: string } = {}): Promise<Buffer> {
    const params = new URLSearchParams();
    if (opts.windowId) params.set("window", opts.windowId);
    if (opts.nodeId) params.set("node", opts.nodeId);
    const qs = params.toString();
    const res = await this.request(`/snapshot${qs ? `?${qs}` : ""}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!isPng(bytes)) {
      throw new HarnessError("/snapshot did not return a PNG");
    }
    return bytes;
  }

  tap(nodeId: string): Promise<ActionResponse> {
    return this.postJson("/tap", ActionResponseSchema, { node: nodeId });
  }

  setText(nodeId: string, text: string): Promise<ActionResponse> {
    return this.postJson("/setText", ActionResponseSchema, { node: nodeId, text });
  }

  action(name: string): Promise<ActionResponse> {
    return this.postJson("/action", ActionResponseSchema, { name });
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}
