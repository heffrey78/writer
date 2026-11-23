import { entryPresences, loadBook } from "@writer/core";
import { nodeSource } from "@writer/core/node";
import { describe, expect, it } from "vitest";
import { allColumns, cellText, fieldEdit, isGap, shownColumns, sortRows, tableText } from "../src/bible/table-columns.ts";

const book = await loadBook(nodeSource(new URL("../../../examples/sample-novel", import.meta.url).pathname));
const table = { book, presences: entryPresences(book) };
const characters = book.entities.filter((e) => e.type === "character");
const columns = allColumns(book, "character");
const column = (key: string) => columns.find((c) => c.key === key)!;
const names = (rows: { name: string }[]) => rows.map((e) => e.name);

describe("the index's table (#168)", () => {
  it("offers the name, the declared fields, the entries' own, where they are, tags and relationships", () => {
    const keys = columns.map((c) => c.key);
    expect(keys.slice(0, 6)).toEqual(["name", "field:age", "field:occupation", "field:appearance", "field:wants", "field:fears"]);
    expect(keys).toContain("field:eyes");
    expect(column("field:eyes")).toMatchObject({ declared: false, field: { holds: "text" } });
    expect(keys).toEqual(expect.arrayContaining(["pieces", "first", "last", "tags", "rel:sibling"]));
    expect(shownColumns(columns, undefined).map((c) => c.key)).toEqual(["name", "field:age", "field:occupation", "field:appearance", "field:wants", "field:fears", "pieces", "first", "tags"]);
  });

  it("keeps the columns chosen, the name first, a field declared since added among the fields, and none that's gone", () => {
    const kept = { shown: ["tags", "field:age", "rel:gone"], known: columns.filter((c) => c.key !== "field:fears").map((c) => c.key) };
    expect(shownColumns(columns, kept).map((c) => c.key)).toEqual(["name", "field:fears", "tags", "field:age"]);
  });

  it("sorts numbers as numbers and empty cells last, either way", () => {
    const age = column("field:age");
    expect(names(sortRows(table, characters, age, "ascending"))).toEqual(["Ben Varn", "Ada Varn", "Tomas Hale", "Mirela Kost"]);
    expect(names(sortRows(table, characters, age, "descending"))).toEqual(["Tomas Hale", "Ada Varn", "Ben Varn", "Mirela Kost"]);
    expect(names(sortRows(table, characters, column("name"), "descending"))).toEqual(["Tomas Hale", "Mirela Kost", "Ben Varn", "Ada Varn"]);
  });

  it("sorts a choice in its options' order", () => {
    const status = { key: "field:status", kind: "field" as const, label: "Status", declared: true, field: { key: "status", holds: "choice" as const, options: ["alive", "missing", "dead"] } };
    const rows = characters.map((e, i) => ({ ...e, fields: { status: ["dead", "alive", "missing", "alive"][i]! } }));
    expect(sortRows(table, rows, status, "ascending").map((e) => e.fields["status"])).toEqual(["alive", "alive", "missing", "dead"]);
  });

  it("says a gap only of a declared field left empty", () => {
    const tomas = characters.find((e) => e.name === "Tomas Hale")!;
    expect(isGap(book, tomas, column("field:occupation"))).toBe(true);
    expect(isGap(book, tomas, column("field:age"))).toBe(false);
    expect(isGap(book, tomas, column("field:eyes"))).toBe(false);
    expect(cellText(table, tomas, column("field:occupation"))).toBe("");
  });

  it("copies as tab-separated lines a spreadsheet pastes as rows and columns", () => {
    const ada = { ...characters.find((e) => e.name === "Ada Varn")!, summary: "x" };
    const odd = { ...ada, name: "Ada\tVarn\nthe second" };
    const text = tableText(table, [ada, odd], [column("name"), column("field:age"), column("tags")]);
    expect(text).toBe(`Name\tAge\tTags\nAda Varn\t31\t${ada.tags.join(", ")}\nAda Varn the second\t31\t${ada.tags.join(", ")}\n`);
  });

  it("edits a field's value in fields:, or its latest change for one that changes", () => {
    const ada = characters.find((e) => e.name === "Ada Varn")!;
    expect(fieldEdit(book, ada, { key: "age", holds: "number" }, 32)).toEqual({ fields: { ...ada.fields, age: 32 } });
    expect(fieldEdit(book, ada, { key: "age", holds: "number" }, undefined)).toEqual({ fields: { occupation: ada.fields["occupation"], eyes: ada.fields["eyes"] } });
    const [first, second] = book.pieces;
    const changing = { ...ada, changes: [{ field: "status", value: "missing", since: second!.id }, { field: "status", value: "alive", since: first!.id }] };
    expect(fieldEdit(book, changing, { key: "status", holds: "text", changes: true }, "dead")).toEqual({ changes: [{ field: "status", value: "dead", since: second!.id }, { field: "status", value: "alive", since: first!.id }] });
  });
});
