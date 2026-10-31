import { Check, Command, Ellipsis, Info, Keyboard, Mic, PanelRight, UserPen } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { UpdateButton, useAbout } from "./about.tsx";
import { desktop, useShowLibrary } from "./desktop.ts";
import { useDictation } from "./dictation/dictation.ts";
import { useDictationSettings } from "./dictation/dictation-settings.tsx";
import { AccountItems, useGitHubAttention } from "./github/connect.tsx";
import { HistoryButtons } from "./history.tsx";
import { useIdentityDialog } from "./identity.tsx";
import { useOverlay } from "./palette.tsx";
import { useTheme, type ThemeChoice } from "./theme.ts";
import { cn } from "./ui/cn.ts";
import { usePageMenu } from "./page-menu.ts";
import { useNarrow } from "./narrow.ts";

/** The look of an item in the top bar's ⋯ menu, for the items pages add. */
export const MENU_ITEM = "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent-soft";

/**
 * The app's frame: a skip link, the top bar, and the page. The bar (heffrey78/gh-writer#136) is home and the page's
 * `heading` on the left; its `actions` (a few, always wanted) and a ⋯ menu on the right, holding the
 * page's `menu` items, the theme, the GitHub account and the keyboard shortcuts. `wide` pages lay
 * themselves out across the window; `chrome={false}` hides the bar (focus mode).
 */
export function Shell({
  actions,
  menu,
  heading,
  children,
  wide,
  chrome = true,
  title,
}: {
  actions?: ReactNode;
  menu?: ReactNode;
  heading?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  chrome?: boolean;
  title?: string;
}) {
  const narrow = useNarrow();
  const showLibrary = useShowLibrary();
  useEffect(() => {
    document.title = title ? `${title} · Writer` : "writer";
  }, [title]);
  return (
    <div className={cn("flex flex-col", wide ? "h-dvh" : "min-h-dvh")}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2">
        Skip to content
      </a>
      {chrome && (
      <header className="flex items-center gap-3 border-b border-rule bg-panel px-4 py-2 max-md:py-1">
        <Link
          to="/"
          onClick={(e) => {
            // In the desktop app, the library has a window of its own.
            if (!desktop) return;
            e.preventDefault();
            showLibrary();
          }}
          className="flex shrink-0 items-center gap-2 rounded-md px-1 font-semibold"
          aria-label={heading ? "Writer: your books" : undefined}
        >
          <Logo />
          {!heading && "writer"}
        </Link>
        {/* On a phone, Android's back does this, and the page's name needs the room (#115). */}
        {!narrow && <HistoryButtons />}
        {heading && <div className="flex min-w-0 items-center gap-1">{heading}</div>}
        <div className="flex flex-1 items-center justify-end gap-2">
          {actions}
          <UpdateButton />
          <MoreMenu items={menu} />
        </div>
      </header>
      )}
      <main id="main" tabIndex={-1} className={cn("flex-1 outline-none", wide ? "min-h-0" : "mx-auto w-full max-w-4xl px-4 py-8")}>
        {children}
      </main>
    </div>
  );
}

const NONE: never[] = [];

/** Everything not needed at every moment: the page's own items, the theme, the account, the shortcuts. */
function MoreMenu({ items }: { items?: ReactNode }) {
  // On a phone they're on the bottom bar's More sheet instead (#100).
  const narrow = useNarrow();
  const pageItems = usePageMenu((s) => (narrow ? NONE : s.items));
  const { theme, setTheme } = useTheme();
  const dictation = useDictation((s) => s.available);
  const { expired, missingScopes } = useGitHubAttention();
  const attention = expired || missingScopes;
  // The menu opens inside the top bar's landmark, not at the end of the page.
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  return (
    <span ref={setAnchor}>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button type="button" aria-label={attention ? "More (GitHub needs reconnecting)" : "More"} title="More" className="relative rounded-md p-1.5 text-muted hover:bg-paper hover:text-ink">
            <Ellipsis className="size-5" aria-hidden />
            {attention && <span className="absolute top-1 right-1 size-2 rounded-full bg-warn" aria-hidden />}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal container={anchor}>
          <DropdownMenu.Content align="end" sideOffset={4} className="z-50 grid min-w-60 rounded-md border border-rule bg-raised p-1 text-ink shadow-lg">
            {(items || pageItems.length > 0) && (
              <>
                {pageItems.map((item) => (
                  <DropdownMenu.Item key={item.id} className={MENU_ITEM} onSelect={item.run}>
                    <PanelRight className="size-4" aria-hidden /> {item.label}
                  </DropdownMenu.Item>
                ))}
                {items}
                <DropdownMenu.Separator className="my-1 h-px bg-rule" />
              </>
            )}
            <DropdownMenu.Label className="px-2 pt-1.5 pb-0.5 text-xs font-semibold tracking-wide text-muted uppercase">Theme</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)} aria-label="Theme">
              {(
                [
                  ["system", "Like the system"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ] as const
              ).map(([value, label]) => (
                <DropdownMenu.RadioItem key={value} value={value} className={cn(MENU_ITEM, "relative pl-7")} onSelect={(e) => e.preventDefault()}>
                  <DropdownMenu.ItemIndicator className="absolute left-3">
                    <Check className="size-3.5" aria-hidden />
                  </DropdownMenu.ItemIndicator>
                  {label}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="my-1 h-px bg-rule" />
            <AccountItems item={MENU_ITEM} />
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => useIdentityDialog.getState().show()}>
              <UserPen className="size-4" aria-hidden /> Your name and email…
            </DropdownMenu.Item>
            {dictation && (
              <DropdownMenu.Item className={MENU_ITEM} onSelect={() => useDictationSettings.getState().set(true)}>
                <Mic className="size-4" aria-hidden /> Dictation…
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className="my-1 h-px bg-rule" />
            {/* The palette, for a hand with no keyboard (a phone's). */}
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => useOverlay.getState().set("palette")}>
              <Command className="size-4" aria-hidden /> Commands…
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => useOverlay.getState().set("shortcuts")}>
              <Keyboard className="size-4" aria-hidden /> Keyboard shortcuts
            </DropdownMenu.Item>
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => useAbout.getState().set(true)}>
              <Info className="size-4" aria-hidden /> About Writer
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  );
}

/** The mark, drawn in the theme's ink and paper so it holds up in both themes. */
function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--ghw-ink)" />
      <path d="M9 23c5-1 9-6 12-14l2 1c-2 8-7 13-13 15z" fill="var(--ghw-paper)" />
      <path d="M8 24h16" stroke="var(--ghw-paper)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
