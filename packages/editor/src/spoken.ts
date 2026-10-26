/*
 * What a settled phrase writes (#81): the book's names as it spells them, and "new paragraph" or
 * "new line" said alone as what they say. Between the recognizer and the text, as the spike (#78)
 * found hints to the recognizer didn't help: every engine wrote "Thomas" for the journal's Tomas,
 * as that's how it sounds. English only, for now (#92).
 */

/** A name the book's index knows, with its other names: an entry's, as the @ menu offers them. */
export interface SpokenName {
  name: string;
  aliases: readonly string[];
}

export type Spoken = { kind: "paragraph" } | { kind: "line" } | { kind: "text"; text: string };

const COMMANDS: Record<string, Spoken["kind"]> = { "new paragraph": "paragraph", "new line": "line" };

/**
 * What `phrase` writes: a new paragraph or line when that's all it says, otherwise its words with
 * any of `names` heard in it written as the book spells them.
 *
 * A name is put right where the recognizer heard a name: the words it capitalised, matching a name
 * or alias in letters or in sound (Thomas for Tomas, Ann for Anne, Catherine for Katherine). Words
 * it wrote in lower case are left as they are, so "the station" in the prose stays so, whatever an
 * index calls The Station. A sentence's first word is capitalised whatever it is, so there a word
 * of three letters must match in letters ("Hop on" stays, though Hope sounds alike).
 */
export function spokenPhrase(phrase: string, names: readonly SpokenName[]): Spoken {
  const command = COMMANDS[phrase.trim().toLowerCase().replace(/[.!?,;:…]+$/, "")];
  if (command) return { kind: command } as Spoken;
  return { kind: "text", text: spellNames(phrase, names) };
}

// A word, with an apostrophe or hyphen inside it; a possessive's 's is matched without it.
const WORD = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;
const POSSESSIVE = /['’]s$/i;

interface Candidate {
  /** As the book spells it. */
  spelling: string[];
  sounds: string[];
}

/** The phrase with each name heard in it written as the book spells it, the longest names first. */
export function spellNames(phrase: string, names: readonly SpokenName[]): string {
  const candidates = names
    .flatMap((n) => [n.name, ...n.aliases])
    .map((spelling) => spelling.match(WORD) ?? [])
    .filter((words) => words.length > 0)
    .map((spelling) => ({ spelling, sounds: spelling.map(sound) }))
    // Too short to tell by sound from an ordinary word ("An" isn't Ann).
    .filter((c) => c.spelling.length > 1 || letters(c.spelling[0]!) >= 3)
    .sort((a, b) => b.spelling.length - a.spelling.length);
  if (!candidates.length) return phrase;

  const words = [...phrase.matchAll(WORD)].map((m) => ({ text: m[0], at: m.index }));
  let out = "";
  let from = 0;
  for (let i = 0; i < words.length; ) {
    const match = candidates.find((c) => matches(c, words, i, phrase));
    if (!match) {
      i++;
      continue;
    }
    const first = words[i]!;
    const last = words[i + match.spelling.length - 1]!;
    const possessive = POSSESSIVE.exec(last.text)?.[0] ?? "";
    // The words between them, as heard (a space, a hyphen).
    let spelled = "";
    for (let k = 0; k < match.spelling.length; k++) {
      spelled += match.spelling[k]!;
      const next = words[i + k + 1];
      if (k < match.spelling.length - 1 && next) spelled += phrase.slice(words[i + k]!.at + words[i + k]!.text.length, next.at);
    }
    // A name the book writes in lower case ("the bell") keeps a sentence's capital.
    if (/^\p{Lu}/u.test(first.text) && startsSentence(phrase, first.at)) spelled = spelled.charAt(0).toUpperCase() + spelled.slice(1);
    out += phrase.slice(from, first.at) + spelled + possessive;
    from = last.at + last.text.length;
    i += match.spelling.length;
  }
  return out + phrase.slice(from);
}

/** Whether the heard words from `i` are the name `c`: capitalised as names are, and alike in sound. */
function matches(c: Candidate, words: { text: string; at: number }[], i: number, phrase: string): boolean {
  if (i + c.spelling.length > words.length) return false;
  return c.spelling.every((spelled, k) => {
    const heard = words[i + k]!.text.replace(POSSESSIVE, "");
    // The recognizer took it for a name: its first letter is a capital, as the book's is.
    const named = heard.charAt(0) !== heard.charAt(0).toLowerCase() || spelled.charAt(0) === spelled.charAt(0).toLowerCase();
    if (!named || sound(heard) !== c.sounds[k]) return false;
    if (heard.toLowerCase() === spelled.toLowerCase()) return true;
    // Alike only in sound: not a word too short to tell from an ordinary one.
    return letters(heard) >= (k === 0 && startsSentence(phrase, words[i]!.at) ? 4 : 3);
  });
}

/** Whether the word at `at` starts a sentence of the phrase (or the phrase). */
const startsSentence = (phrase: string, at: number) => {
  const before = phrase.slice(0, at);
  return before.trim() === "" || /[.!?…]["”’)\]]*\s*$/.test(before);
};

const letters = (word: string) => word.replace(/[^\p{L}]/gu, "").length;

/**
 * A word as it sounds, roughly, for English names: spellings that sound alike reduce to the same
 * letters. Lower case, accents gone; th, ph, ck, c, q, x and z as they're said; an h after a
 * consonant and a final e unheard; a doubled letter once.
 */
export function sound(word: string): string {
  let s = word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  s = s
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/([^aeiouy])h/g, "$1")
    .replace(/(.)\1+/g, "$1");
  if (s.length > 2) s = s.replace(/e$/, "");
  return s.replace(/y/g, "i");
}
