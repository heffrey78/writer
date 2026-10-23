// @vitest-environment jsdom
import { BASE_SIDEBAR, kindByKey, type BookKind } from "@writer/core";
import { campaign, journal, KINDS, nonfiction, novel } from "@writer/kinds";
import { citationsWeb } from "@writer/module-citations/web";
import { dailyWeb } from "@writer/module-daily/web";
import { draftingBoardWeb } from "@writer/module-drafting-board/web";
import { offPageEventsWeb } from "@writer/module-off-page-events/web";
import { plotlinesWeb } from "@writer/module-plotlines/web";
import { presenceWeb } from "@writer/module-presence/web";
import { storyTimeWeb } from "@writer/module-story-time/web";
import { Users } from "lucide-react";
import { describe, expect, it } from "vitest";
import { registerWebModule } from "../src/modules.tsx";
import { groups, homeOf } from "../src/novel/sidebar.tsx";

/** Each kind's sidebar (#61): its groups in its words, its pages in its order, with the app's modules. */

for (const module of [plotlinesWeb, presenceWeb, storyTimeWeb, offPageEventsWeb, draftingBoardWeb, dailyWeb, citationsWeb]) registerWebModule(module);

const sidebar = (kind: BookKind, onGitHub = true) => groups(onGitHub, kind).map((g) => [g.label, g.places.map((p) => p.label)]);

describe("the sidebar", () => {
  it("is the novel's as it was: Plan, then Revise", () => {
    expect(sidebar(kindByKey("novel"))).toEqual([
      ["Plan", ["Outline", "Story map", "Relationships", "Notes", "Progress", "Story bible"]],
      ["Revise", ["Compare", "Issues"]],
    ]);
    expect(novel.sidebar).toBeUndefined();
  });

  it("is a journal's: looking back first, then its people and places, with no outline or comparing", () => {
    expect(sidebar(kindByKey("journal"))).toEqual([
      ["Look back", ["Calendar", "Read", "Notes", "Issues"]],
      ["People and places", ["Index", "Relationships", "Story map", "Progress"]],
    ]);
    // Issues only for a book on GitHub.
    expect(sidebar(kindByKey("journal"), false)[0]).toEqual(["Look back", ["Calendar", "Read", "Notes"]]);
  });

  it("is a campaign's and a non-fiction book's own", () => {
    expect(sidebar(kindByKey("campaign"))).toEqual([
      ["Prep", ["Codex", "Notes", "Outline", "Issues"]],
      ["The world", ["Relationships", "Story map"]],
      ["Look back", ["Progress", "Compare"]],
    ]);
    expect(sidebar(kindByKey("nonfiction"))).toEqual([
      ["Plan", ["Outline", "Index", "Notes", "Relationships", "Story map", "Progress"]],
      ["Revise", ["Issues", "Compare"]],
    ]);
  });

  it("shows every page a shipped kind names, on GitHub", () => {
    for (const { key } of KINDS) {
      const kind = kindByKey(key);
      const named = (kind.sidebar ?? BASE_SIDEBAR).flatMap((g) => g.pages);
      expect(groups(true, kind).flatMap((g) => g.places), key).toHaveLength(named.length);
    }
  });

  it("puts a module's page the kind doesn't name in its module's group, or the first where the kind has none", () => {
    registerWebModule({ id: "company", views: [{ path: "company", label: "Company", icon: Users, group: "Revise", render: () => null }] });
    expect(sidebar({ ...kindByKey("nonfiction"), modules: [...nonfiction.modules!, "company"] })[1]).toEqual(["Revise", ["Issues", "Compare", "Company"]]);
    expect(sidebar({ ...kindByKey("journal"), modules: [...journal.modules!, "company"] })[0]).toEqual(["Look back", ["Calendar", "Read", "Notes", "Issues", "Company"]]);
  });

  it("names the page a kind's books open on, if it's there", () => {
    expect(homeOf(true, kindByKey("novel"))).toBeUndefined();
    const journal = kindByKey("journal");
    expect(homeOf(true, { ...journal, home: "calendar" })).toBe("calendar");
    expect(homeOf(true, { ...journal, home: "index" })).toBe("bible");
    // Issues off GitHub, and a page no module adds: the first section, as without one.
    expect(homeOf(false, { ...journal, home: "issues" })).toBeUndefined();
    expect(homeOf(true, { ...journal, home: "nowhere" })).toBeUndefined();
  });
});
