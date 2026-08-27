import { describe, expect, it } from "vitest";
import type { UINode } from "../src/contract.js";
import { findAll, findNode, parseSelector } from "../src/selector.js";

const tree: UINode = {
  id: "root",
  role: "window",
  label: "Main",
  children: [
    { id: "email", role: "textfield", label: "Email" },
    { id: "save", role: "button", label: "Save" },
    { id: "cancel", role: "button", label: "Cancel" },
    {
      id: "group",
      role: "group",
      children: [{ id: "nested-save", role: "button", label: "Save" }],
    },
  ],
};

describe("parseSelector", () => {
  it("parses an id selector", () => {
    expect(parseSelector("#save")).toEqual({ id: "save" });
    expect(parseSelector("  #email  ")).toEqual({ id: "email" });
  });

  it("parses role + label", () => {
    expect(parseSelector('Button "Save"')).toEqual({ role: "button", label: "Save" });
    expect(parseSelector('textfield "Email Address"')).toEqual({
      role: "textfield",
      label: "Email Address",
    });
  });

  it("parses label-only", () => {
    expect(parseSelector('"Save"')).toEqual({ label: "Save" });
  });

  it("parses role-only", () => {
    expect(parseSelector("Button")).toEqual({ role: "button" });
  });

  it("rejects garbage", () => {
    expect(() => parseSelector("")).toThrow();
    expect(() => parseSelector("a b c")).toThrow(/Unrecognized/);
  });
});

describe("findNode / findAll", () => {
  it("finds by id", () => {
    expect(findNode(tree, { id: "save" })?.label).toBe("Save");
  });

  it("finds by role + label, breadth-first", () => {
    expect(findNode(tree, { role: "button", label: "Save" })?.id).toBe("save");
  });

  it("returns undefined on a miss", () => {
    expect(findNode(tree, { id: "nope" })).toBeUndefined();
  });

  it("findAll returns every match", () => {
    expect(findAll(tree, { role: "button" }).map((n) => n.id)).toEqual([
      "save",
      "cancel",
      "nested-save",
    ]);
    expect(findAll(tree, { role: "button", label: "Save" }).map((n) => n.id)).toEqual([
      "save",
      "nested-save",
    ]);
  });
});
