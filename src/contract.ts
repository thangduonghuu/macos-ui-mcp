/**
 * Wire format between the MCP server and the in-app harness.
 *
 * Harness HTTP contract (localhost, DEBUG builds only):
 *   GET  /windows                          -> WindowsResponse
 *   GET  /tree?window=<id>                 -> TreeResponse         (default: key window)
 *   GET  /snapshot?window=<id>&node=<id>   -> image/png bytes
 *   POST /tap      { node: string }        -> ActionResponse
 *   POST /setText  { node: string, text }  -> ActionResponse
 *   POST /action   { name: string }        -> ActionResponse
 */
import { z } from "zod";

export interface UINode {
  /** Stable within a session. From `.accessibilityIdentifier()` when set, else synthesized. */
  id: string;
  /** button, textfield, text, checkbox, window, group, ... */
  role: string;
  label?: string;
  value?: string | number | boolean;
  enabled?: boolean;
  focused?: boolean;
  frame?: { x: number; y: number; width: number; height: number };
  children?: UINode[];
}

const FrameSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const UINodeSchema: z.ZodType<UINode> = z.lazy(() =>
  z.object({
    id: z.string(),
    role: z.string(),
    label: z.string().optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    enabled: z.boolean().optional(),
    focused: z.boolean().optional(),
    frame: FrameSchema.optional(),
    children: z.array(UINodeSchema).optional(),
  }),
);

export const WindowSchema = z.object({
  id: z.string(),
  title: z.string(),
  key: z.boolean(),
  frame: FrameSchema,
});
export type Window = z.infer<typeof WindowSchema>;

export const WindowsResponseSchema = z.object({ windows: z.array(WindowSchema) });
export type WindowsResponse = z.infer<typeof WindowsResponseSchema>;

export const TreeResponseSchema = z.object({ window: WindowSchema, tree: UINodeSchema });
export type TreeResponse = z.infer<typeof TreeResponseSchema>;

export const ActionResponseSchema = z.object({
  ok: z.boolean(),
  detail: z.string().optional(),
});
export type ActionResponse = z.infer<typeof ActionResponseSchema>;
