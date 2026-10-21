import { defineModule, type BookModule, type CompileLayout, type CompilePreset } from "@writer/core";

/*
 * Standard manuscript format (D14, #32): how agents and editors ask for a manuscript. Chapters headed
 * "Chapter Four: The Flood" (or as the preset asks), parts "Part One"; a title page with the contact
 * details and a rounded word count; from page 2 a running header, Surname / SHORT TITLE / page;
 * double-spaced; THE END after the last chapter. The Word file and the PDF are laid out so, and the
 * EPUB's headings say the same. The Novel compiles with it.
 */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** A number in words, as chapter headings write it: 1 → "One", 42 → "Forty-Two", 101 → "One Hundred One". */
export function numberWords(n: number): string {
  if (n < 20) return ONES[n] ?? String(n);
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${numberWords(n % 100)}` : ""}`;
  return String(n);
}

/** "Chapter Four: The Flood", "Chapter Four" or "The Flood", as the preset asks (a chapter without a title: its number). */
function heading(preset: CompilePreset, n: number, title: string | undefined): string {
  const number = `Chapter ${numberWords(n)}`;
  const style = preset.chapter_heading ?? "number-and-title";
  if (style === "number" || !title) return number;
  if (style === "title") return title;
  return `${number}: ${title}`;
}

/** The title page's word count: manuscript format rounds it (to hundreds under 10,000 words, thousands above). */
function wordCount(preset: CompilePreset, words: number): string | undefined {
  const style = preset.word_count ?? "rounded";
  if (style === "none") return undefined;
  const format = (n: number) => n.toLocaleString("en-US");
  if (style === "exact") return `${format(words)} words`;
  const step = words < 10_000 ? 100 : 1000;
  return `about ${format(Math.max(step, Math.round(words / step) * step))} words`;
}

/** A short title for the running header: the title's first three words without a leading article. */
function shortOf(title: string): string {
  const words = title.replace(/^(the|a|an)\s+/i, "").split(/\s+/).filter(Boolean);
  return words.slice(0, 3).join(" ") || title;
}

export const MANUSCRIPT: CompileLayout = {
  key: "manuscript",
  label: "Standard manuscript format",
  heading: ({ preset, number, title }) => heading(preset, number, title),
  partHeading: ({ number }) => `Part ${numberWords(number)}`,
  titlePage: ({ preset, author, words }) => ({ contact: preset.title_page?.contact ?? (author ? [author] : []), wordCount: wordCount(preset, words) }),
  runningHead: ({ preset, title, author }) => {
    const surname = preset.title_page?.surname ?? (author.trim().split(/\s+/).at(-1) || "Anonymous");
    const shortTitle = (preset.title_page?.short_title ?? shortOf(title)).toUpperCase();
    return `${surname} / ${shortTitle} / `;
  },
  end: "THE END",
  spacing: 2,
  says: {
    docx: "standard manuscript format, for agents and editors",
    pdf: "laid out like the Word file",
    cover: "On the EPUB's cover and the PDF's first page. Word manuscripts go out without one, as agents expect.",
  },
};

export const manuscriptFormat: BookModule = defineModule({ id: "manuscript-format", label: "Manuscript format", layouts: [MANUSCRIPT] });
