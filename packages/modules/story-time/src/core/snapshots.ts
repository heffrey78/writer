import { vocabulary, type Book } from "@writer/core";
import { draw } from "@writer/core/snapshots";
import { defaultLanes, itemTitle, jump, lanesOf, timeline, when, type LaneMode } from "./timeline.ts";

/* The timeline's snapshots (D14, #30): in Mermaid, which github.com draws, and as SVG, drawn as the app draws it. */

const { colours: C, font: FONT, esc, cut, width, svg, ordinal, round: r } = draw;

/** Mermaid's timeline uses ":" between a period and its events, so a colon in a label is written as "∶". */
const tl = (s: string) => s.replace(/:/g, "∶").replace(/#/g, "No.");

/** The timeline in Mermaid: each moment in story time with what happens then, the book's position and flashbacks noted. */
export function timelineMermaid(novel: Book): string {
  const t = timeline(novel, defaultLanes(novel.kind));
  const lines = ["timeline", "  title Story time"];
  let period = "";
  let events: string[] = [];
  const flush = () => period && lines.push(`  ${tl(period)} : ${events.map(tl).join(" : ")}`);
  for (const item of t.items) {
    const what =
      item.kind === "scene"
        ? `${item.scene.title} (${ordinal(novel.pieces.indexOf(item.scene) + 1)} in the book${t.flashbacks.has(item.scene.id) ? ", a flashback" : ""})`
        : `${item.event.title} (off page)`;
    const at = when(item);
    if (at === period) events.push(what);
    else {
      flush();
      period = at;
      events = [what];
    }
  }
  flush();
  if (!t.items.length) lines.push(`  No times yet : Give ${vocabulary(novel.kind).piece.many} a time in their details`);
  return lines.join("\n") + "\n";
}

const SLOT = 136;
const LANE_H = 54;

/** The timeline as drawn in the app: story time in lanes (by point of view, for a novel), joined to reading order below. */
export function timelineSvg(novel: Book, mode: LaneMode = defaultLanes(novel.kind)): string {
  const t = timeline(novel, mode);
  const title = "The book in story time, and in reading order";
  if (!t.items.length) return svg(420, 60, title, `<text x="20" y="36" ${FONT} font-size="13" fill="${C.muted}">No ${vocabulary(novel.kind).piece.one} or event has a time yet.</text>\n`);
  const head = 150;
  const top = 44;
  const axisH = 50;
  const lanesY = top + axisH;
  const linksY = lanesY + t.lanes.length * LANE_H;
  const linksH = 70;
  const readY = linksY + linksH;
  const reading = novel.pieces.filter((s) => t.storyRank.has(s.id));
  const w = head + t.items.length * SLOT + 20;
  const readSlot = (t.items.length * SLOT) / Math.max(1, reading.length);
  const h = readY + 34 + 16;
  let b = `<text x="20" y="26" ${FONT} font-size="14" font-weight="600" fill="${C.ink}">${esc(title)}</text>\n`;
  b += `<text x="20" y="${top + 26}" ${FONT} font-size="11" fill="${C.muted}">Story time</text>\n`;
  t.items.forEach((item, i) => {
    const x = head + i * SLOT;
    b += `<line x1="${x}" y1="${top}" x2="${x}" y2="${linksY}" stroke="${C.rule}"/>\n`;
    // "Day 3, 18:30 (3 Mar 2024)": the day on one line, the date under it.
    const [first, second] = when(item).split(" (");
    b += `<text x="${x + 6}" y="${top + (second ? 27 : 32)}" ${FONT} font-size="10.5" fill="${C.muted}">${esc(cut(first!, 22))}${second ? `<tspan x="${x + 6}" dy="12">${esc(cut(second.replace(/\)$/, ""), 22))}</tspan>` : ""}</text>\n`;
    const prev = t.items[i - 1];
    if (prev) {
      const gap = jump(prev.at, item.at);
      if (gap && gap !== "same time") b += `<rect x="${x - width(gap, 10) / 2 - 4}" y="${top + 2}" width="${width(gap, 10) + 8}" height="15" rx="3" fill="${C.accentSoft}"/><text x="${x}" y="${top + 13}" text-anchor="middle" ${FONT} font-size="10" fill="${C.ink}">${esc(gap)}</text>\n`;
    }
  });
  t.lanes.forEach((lane, k) => {
    const y = lanesY + k * LANE_H;
    b += `<line x1="20" y1="${y}" x2="${w - 20}" y2="${y}" stroke="${C.rule}"/>\n<text x="20" y="${y + 30}" ${FONT} font-size="12.5" font-weight="600" fill="${C.ink}">${esc(cut(lane.name, 18))}</text>\n`;
    t.items.forEach((item, i) => {
      if (!lanesOf(novel, item, mode).includes(lane.id)) return;
      const x = head + i * SLOT + 6;
      const flashback = item.kind === "scene" && t.flashbacks.has(item.scene.id);
      const event = item.kind === "event";
      b += `<rect x="${x}" y="${y + 7}" width="${SLOT - 12}" height="40" rx="6" fill="${event ? C.paper : C.paper}" stroke="${flashback ? C.warn : event ? C.muted : C.rule}" stroke-width="${flashback ? 2 : 1}"${event ? ` stroke-dasharray="4 3"` : ""}/>\n`;
      b += `<text x="${x + 8}" y="${y + 24}" ${FONT} font-size="11.5" font-weight="600"${event ? ` font-style="italic"` : ""} fill="${C.ink}">${esc(cut(itemTitle(item), 19))}</text>\n`;
      const sub = item.kind === "scene" ? (flashback ? `${ordinal(novel.pieces.indexOf(item.scene) + 1)} · flashback` : `${ordinal(novel.pieces.indexOf(item.scene) + 1)} in the book`) : "off page";
      b += `<text x="${x + 8}" y="${y + 39}" ${FONT} font-size="10" fill="${flashback ? C.warn : C.muted}">${esc(sub)}</text>\n`;
    });
  });
  b += `<line x1="20" y1="${linksY}" x2="${w - 20}" y2="${linksY}" stroke="${C.rule}"/>\n`;
  reading.forEach((scene, rIdx) => {
    const k = t.storyRank.get(scene.id)!;
    const flashback = t.flashbacks.has(scene.id);
    b += `<line x1="${head + k * SLOT + SLOT / 2}" y1="${linksY}" x2="${r(head + rIdx * readSlot + readSlot / 2)}" y2="${readY}" stroke="${flashback ? C.warn : C.rule}" stroke-width="${flashback ? 2.5 : 1.5}"/>\n`;
    b += `<text x="${r(head + rIdx * readSlot + 4)}" y="${readY + 20}" ${FONT} font-size="10.5" fill="${flashback ? C.warn : C.ink}">${esc(cut(`${rIdx + 1}. ${scene.title}`, Math.floor(readSlot / 6.2)))}</text>\n`;
  });
  b += `<line x1="20" y1="${readY}" x2="${w - 20}" y2="${readY}" stroke="${C.rule}"/>\n<text x="20" y="${readY + 20}" ${FONT} font-size="11" fill="${C.muted}">Reading order</text>\n`;
  return svg(w, h, title, b);
}

const fence = (s: string) => "```mermaid\n" + s + "```\n";

/** The timeline's diagram for the book's diagrams/ folder, and its section of their README. */
export function timelineSnapshots(book: Book) {
  const hasTimes = timeline(book, defaultLanes(book.kind)).items.length > 0;
  const w = vocabulary(book.kind);
  return {
    files: hasTimes ? ([["diagrams/timeline.svg", timelineSvg(book)]] as const) : [],
    readme: [
      "## Timeline",
      "",
      ...(hasTimes
        ? ["When things happen in the story, next to where they come in the book.", "", fence(timelineMermaid(book)), "![The book in story time, and in reading order](timeline.svg)"]
        : [`No ${w.piece.one} or event has a time yet.`]),
      "",
    ],
  };
}
