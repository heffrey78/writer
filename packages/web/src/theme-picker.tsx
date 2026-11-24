import { Check } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { create } from "zustand";
import { onAndroid } from "./platform.ts";
import { useTheme, type ThemeChoice } from "./theme.ts";
import { contrast, derive, isHex, SWATCHES, themeById, THEMES, type Colors, type Mode, type Own, type Role } from "./themes.ts";
import { Button } from "./ui/button.tsx";
import { cn } from "./ui/cn.ts";
import { Modal } from "./ui/dialog.tsx";

/**
 * Whether the Theme picker is open (More › Theme…, or the palette's Theme…), and what takes the focus
 * when it closes, where what opened it is gone (the menu's item: its More button).
 */
export const useThemePicker = create<{ open: boolean; returnTo?: HTMLElement | null; set: (open: boolean, returnTo?: HTMLElement | null) => void }>((set) => ({
  open: false,
  set: (open, returnTo) => set({ open, returnTo }),
}));

const DARK = "(prefers-color-scheme: dark)";

/** Light or dark, as the system has it now. */
function useSystemMode(): Mode {
  const [dark, setDark] = useState(() => matchMedia(DARK).matches);
  useEffect(() => {
    const query = matchMedia(DARK);
    const on = () => setDark(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);
  return dark ? "dark" : "light";
}

const MODES: readonly [ThemeChoice, string][] = [
  ["system", "Follow the system"],
  ["light", "Light"],
  ["dark", "Dark"],
];

const DEVICE = onAndroid ? "phone" : "computer";

/** A segment's or a row's look, by whether its radio is chosen and has the keyboard's focus. */
const CHOICE = "peer-checked:bg-accent-soft peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-accent";

/**
 * The Theme picker (#190, D21): light or dark, and the colors, each applied as it's picked, kept on
 * this device. A dialog on the desktop; on a phone it fills the screen, and Android's back leaves it.
 */
export function ThemePicker() {
  const open = useThemePicker((s) => s.open);
  return open ? <Picker onClose={() => useThemePicker.getState().set(false, useThemePicker.getState().returnTo)} /> : null;
}

function Picker({ onClose }: { onClose: () => void }) {
  const returnTo = useThemePicker((s) => s.returnTo);
  const { appearance, setTheme, setPalette, reset } = useTheme();
  const system = useSystemMode();
  const shown = appearance.mode === "system" ? system : appearance.mode;
  const id = useId();
  return (
    <Modal
      title="Theme"
      onClose={onClose}
      focusAfter={() => (returnTo?.isConnected ? returnTo : undefined)}
      className="md:w-[min(52rem,calc(100vw-2rem))] max-md:inset-0 max-md:h-full max-md:max-h-none max-md:w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="grid min-w-0 content-start gap-6">
          <fieldset className="min-w-0">
            <legend className="mb-2 font-semibold">Light or dark</legend>
            <div className="grid grid-cols-3 overflow-hidden rounded-md border border-rule">
              {MODES.map(([value, label], i) => (
                <label key={value} className={cn("relative cursor-pointer", i > 0 && "border-l border-rule")}>
                  <input type="radio" name={`${id}-mode`} value={value} checked={appearance.mode === value} onChange={() => setTheme(value)} className="peer sr-only" />
                  <span className={cn("flex h-11 items-center justify-center px-1 text-center text-sm leading-tight peer-checked:font-semibold", CHOICE)}>{label}</span>
                </label>
              ))}
            </div>
            {appearance.mode === "system" && (
              <p className="mt-2 text-sm text-muted">
                This {DEVICE} is {system} at the moment; Writer turns {system === "light" ? "dark" : "light"} with it.
              </p>
            )}
          </fieldset>

          <fieldset className="min-w-0">
            <legend className="mb-2 font-semibold">Colors</legend>
            <div className="grid overflow-hidden rounded-md border border-rule">
              {[...THEMES, OWN_CARD].map((t, i) => {
                const checked = appearance.palette === t.id;
                const colors = t.id === "own" ? appearance.own?.[shown] : t[shown];
                return (
                  <label key={t.id} className={cn("relative block cursor-pointer", i > 0 && "border-t border-rule")}>
                    <input
                      type="radio"
                      name={`${id}-palette`}
                      value={t.id}
                      checked={checked}
                      onChange={() => setPalette(t.id)}
                      aria-label={t.name}
                      aria-describedby={`${id}-${t.id}`}
                      className="peer sr-only"
                    />
                    <span className={cn("flex min-h-12 items-center gap-3 px-3 py-2", CHOICE)}>
                      {colors ? <Swatches colors={colors} /> : <span aria-hidden className="h-5 w-[2.75rem] shrink-0 rounded-full border border-dashed border-muted" />}
                      <span className="grid min-w-0 flex-1">
                        <span className={cn(checked && "font-semibold")}>{t.name}</span>
                        {/* Quiet text would be too faint on the chosen row's tint, over the dialog. */}
                        <span id={`${id}-${t.id}`} className={cn("text-sm", checked ? "text-ink" : "text-muted")}>
                          {t.line}
                        </span>
                      </span>
                      {checked && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {appearance.palette === "own" && appearance.own && <OwnColorsSection own={appearance.own} mode={shown} />}
        </div>

        <figure className="grid min-w-0 content-start gap-2">
          <figcaption className="text-xs font-semibold tracking-wide text-muted uppercase">Preview</figcaption>
          <Preview />
          <p className="text-sm text-muted">
            The whole app changes as you pick, this {onAndroid ? "page" : "window"} too. There's nothing to save: the theme is kept on this {DEVICE}
            {onAndroid ? ", and your computer keeps its own" : ", and your phone keeps its own"}.
          </p>
          <p className="text-sm text-muted">In the palette: Theme: Study, Theme: dark, and the rest.</p>
        </figure>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button onClick={reset}>Back to Paper</Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

/** Your own colors as a card among the themes', their colors the record's own. */
const OWN_CARD = { id: "own" as const, name: "Your own", line: "Your colors from a short list, checked as you pick", light: undefined, dark: undefined };

const ROLES: readonly [Role, string][] = [
  ["paper", "Paper"],
  ["ink", "Text"],
  ["accent", "Links"],
];

/**
 * A writer's own paper, text and links (#191), for the mode on screen: each from six swatches or a
 * hex code. What they make is checked as they're picked, and a color too faint to read is replaced
 * by its nearest shade that reads, named here and said aloud.
 */
function OwnColorsSection({ own, mode }: { own: Own; mode: Mode }) {
  const setOwn = useTheme((s) => s.setOwn);
  const id = useId();
  const raw = own[mode];
  const made = derive(raw);
  const checks = [
    { label: "Text on paper", color: raw.ink, now: made.ink },
    { label: "Links and the focus ring", color: raw.accent, now: made.accent },
    { label: "Quiet text, made from your text color", color: made.muted, now: made.muted },
  ];
  return (
    <section aria-labelledby={`${id}-own`} className="grid min-w-0 gap-4 rounded-md border border-rule p-3">
      <h3 id={`${id}-own`} className="font-semibold">
        Your own, {mode}, started from {themeById(own.from)?.name ?? "Paper"}
      </h3>
      {ROLES.map(([role, name]) => (
        <fieldset key={role} className="min-w-0">
          <legend className="mb-1.5 text-sm font-semibold">{name}</legend>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES[mode][role].map((hex) => (
              <label key={hex} className="relative cursor-pointer" title={hex}>
                <input type="radio" name={`${id}-${role}`} checked={raw[role] === hex} onChange={() => setOwn(mode, role, hex)} aria-label={`${name} ${hex}`} className="peer sr-only" />
                <span
                  className="block size-8 rounded-full shadow-[inset_0_0_0_1px_var(--ghw-rule)] peer-checked:outline-2 peer-checked:outline-offset-2 peer-checked:outline-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                  style={{ background: hex }}
                />
              </label>
            ))}
            <HexField value={raw[role]} label={`${name} color, as a hex code`} onColor={(hex) => setOwn(mode, role, hex)} />
          </div>
        </fieldset>
      ))}
      <ul aria-live="polite" className="grid gap-2 text-sm">
        {checks.map((c) => {
          const adjusted = c.now !== c.color;
          return (
            <li key={c.label} className="flex gap-2">
              <span aria-hidden className={cn("w-3 shrink-0 font-bold", adjusted ? "text-warn" : "text-ok")}>
                {adjusted ? "!" : "✓"}
              </span>
              <span className="grid min-w-0 gap-1">
                <span>
                  <strong className="font-semibold">{c.label}</strong> {contrast(c.color, raw.paper).toFixed(1)} : 1
                </span>
                {adjusted &&
                  (contrast(c.now, raw.paper) >= 4.5 ? (
                    <span className="flex flex-wrap items-center gap-1.5">
                      Too faint on this paper (4.5 : 1 needed). Writer uses the nearest shade that reads:{" "}
                      <span aria-hidden className="inline-block size-4 rounded-full shadow-[inset_0_0_0_1px_var(--ghw-rule)]" style={{ background: c.now }} />
                      <code className="font-mono">{c.now}</code>
                    </span>
                  ) : (
                    // A mid-tone paper: no shade of any color reads on it at 4.5.
                    <span>Nothing reads at 4.5 : 1 on this paper. Pick a lighter or a darker paper.</span>
                  ))}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A color typed as a hex code: taken once it's whole ("#e0b84a", or without the #). */
function HexField({ value, label, onColor }: { value: string; label: string; onColor: (hex: string) => void }) {
  const [text, setText] = useState(value);
  // A swatch picked, or the mode changed: the field shows the color in use.
  useEffect(() => setText(value), [value]);
  const hex = `#${text.trim().replace(/^#/, "").toLowerCase()}`;
  const invalid = text.trim() !== "" && !isHex(hex);
  return (
    <input
      type="text"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const next = `#${e.target.value.trim().replace(/^#/, "").toLowerCase()}`;
        if (isHex(next) && next !== value) onColor(next);
      }}
      aria-label={label}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      autoComplete="off"
      className="h-8 w-24 rounded-md border border-rule bg-paper px-2 font-mono text-sm aria-invalid:border-danger"
    />
  );
}

/** A theme's paper, text and links, in the mode shown, as three overlapping dots. */
function Swatches({ colors }: { colors: Colors }) {
  const dot = "size-5 rounded-full shadow-[inset_0_0_0_1px_var(--ghw-rule)]";
  return (
    <span aria-hidden className="flex shrink-0">
      <span className={dot} style={{ background: colors.paper }} />
      <span className={cn(dot, "-ml-1.5")} style={{ background: colors.ink }} />
      <span className={cn(dot, "-ml-1.5")} style={{ background: colors.accent }} />
    </span>
  );
}

/** A passage in the writing view's own styles: the paper, the text, a mention and a selection. */
function Preview() {
  return (
    <div className="rounded-md border border-rule bg-paper px-4">
      <div className="ghw-prose" style={{ padding: "0.75rem 0" }}>
        <p>
          The train gave up the last of its heat as it pulled into Varn, and <span className="ghw-mention">Ada</span> was the only passenger who stood.
        </p>
        <p>
          Twelve years had not moved the station clock. It still ran <span style={{ background: "var(--ghw-selection)" }}>four minutes fast</span>, as it had when her father set it.
        </p>
      </div>
    </div>
  );
}
