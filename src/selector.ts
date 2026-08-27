import type { UINode } from "./contract.js";

/**
 * Minimal selector grammar (deliberately small):
 *   #identifier       -> match by node id
 *   Role "Label"      -> match by role (case-insensitive) and exact label
 *   "Label"           -> match by exact label, any role
 *   Role              -> match by role (case-insensitive)
 */
export interface Selector {
  id?: string;
  role?: string;
  label?: string;
}

export function parseSelector(input: string): Selector {
  const s = input.trim();
  if (!s) throw new Error("Empty selector");

  if (s.startsWith("#")) {
    const id = s.slice(1).trim();
    if (!id) throw new Error(`Invalid id selector: ${input}`);
    return { id };
  }

  const roleAndLabel = s.match(/^([A-Za-z][\w-]*)\s+"([^"]*)"$/);
  if (roleAndLabel) {
    return { role: roleAndLabel[1].toLowerCase(), label: roleAndLabel[2] };
  }

  const labelOnly = s.match(/^"([^"]*)"$/);
  if (labelOnly) return { label: labelOnly[1] };

  const roleOnly = s.match(/^([A-Za-z][\w-]*)$/);
  if (roleOnly) return { role: roleOnly[1].toLowerCase() };

  throw new Error(`Unrecognized selector: ${input}`);
}

function matches(node: UINode, sel: Selector): boolean {
  if (sel.id !== undefined && node.id !== sel.id) return false;
  if (sel.role !== undefined && node.role.toLowerCase() !== sel.role) return false;
  if (sel.label !== undefined && node.label !== sel.label) return false;
  return true;
}

/** Breadth-first search; returns the first node matching the selector. */
export function findNode(root: UINode, sel: Selector): UINode | undefined {
  const queue: UINode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (matches(node, sel)) return node;
    if (node.children) queue.push(...node.children);
  }
  return undefined;
}

/** All matches, breadth-first. Used to report ambiguous selectors. */
export function findAll(root: UINode, sel: Selector): UINode[] {
  const out: UINode[] = [];
  const queue: UINode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (matches(node, sel)) out.push(node);
    if (node.children) queue.push(...node.children);
  }
  return out;
}
