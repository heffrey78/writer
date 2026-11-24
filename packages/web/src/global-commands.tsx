import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, keys } from "./api.ts";
import { githubKey, useConnect, useGitHub } from "./github/connect.tsx";
import { useCommands } from "./commands.ts";
import { useAbout } from "./about.tsx";
import { useIdentityDialog } from "./identity.tsx";
import { useOpenNovel, useShowLibrary } from "./desktop.ts";
import { APP_KEYS, useOverlay } from "./palette.tsx";
import { useTheme, type ThemeChoice } from "./theme.ts";
import { useThemePicker } from "./theme-picker.tsx";
import { THEMES } from "./themes.ts";
import { UI_FONTS, UI_SIZES, WRITING_FONTS, WRITING_SIZES } from "./text-settings.ts";
import { onAndroid } from "./platform.ts";
import { useDictation } from "./dictation/dictation.ts";
import { useDictationSettings } from "./dictation/dictation-settings.tsx";

/** Commands available everywhere: the library, each novel, the theme, the shortcut reference. */
export function GlobalCommands() {
  const openNovel = useOpenNovel();
  const showLibrary = useShowLibrary();
  const queryClient = useQueryClient();
  const library = useQuery({ queryKey: keys.library, queryFn: api.library, staleTime: 30_000 });
  const novels = library.data?.novels ?? [];
  const github = useGitHub();
  const signedIn = github.data?.signedIn ?? false;
  const dictation = useDictation((s) => s.available);
  const own = useTheme((s) => !!s.appearance.own);
  useCommands(
    () => [
      { id: "app.library", title: "Go to your books", group: "Go to", run: () => showLibrary() },
      { id: "app.new", title: "New book…", group: "Books", keywords: ["start", "create"], run: () => showLibrary("/?add=new") },
      ...(onAndroid ? [] : [{ id: "app.open-folder", title: "Open a book's folder…", group: "Books", keywords: ["add"], run: () => showLibrary("/?add=open") }]),
      { id: "app.clone", title: "Clone a book from GitHub…", group: "Books", keywords: ["add", "repository"], run: () => showLibrary("/?add=clone") },
      ...novels.map((n) => ({ id: `app.open.${n.id}`, title: `Open “${n.title}”`, group: "Books", keywords: [n.path], run: () => openNovel(n.id) })),
      ...(["system", "light", "dark"] as ThemeChoice[]).map((t) => ({
        id: `app.theme.${t}`,
        title: `Theme: ${t === "system" ? "follow the system" : t}`,
        group: "App",
        run: () => useTheme.getState().setTheme(t),
        isActive: () => useTheme.getState().theme === t,
      })),
      ...THEMES.map((t) => ({
        id: `app.palette.${t.id}`,
        title: `Theme: ${t.name}`,
        group: "App",
        keywords: ["colors", t.line],
        run: () => useTheme.getState().setPalette(t.id),
        isActive: () => useTheme.getState().appearance.palette === t.id,
      })),
      ...(own ? [{ id: "app.palette.own", title: "Theme: Your own", group: "App", keywords: ["colors"], run: () => useTheme.getState().setPalette("own"), isActive: () => useTheme.getState().appearance.palette === "own" }] : []),
      ...WRITING_FONTS.map((f) => ({ id: `app.font.${f.id}`, title: `Writing font: ${f.name}`, group: "App", keywords: ["text", "typeface"], run: () => useTheme.getState().setText({ font: f.id }), isActive: () => (useTheme.getState().appearance.text?.font ?? "book") === f.id })),
      ...WRITING_SIZES.map((s) => ({ id: `app.size.${s.px}`, title: `Writing size: ${s.name}`, group: "App", keywords: ["text", "bigger", "smaller", `${s.px} px`], run: () => useTheme.getState().setText({ size: s.px }), isActive: () => (useTheme.getState().appearance.text?.size ?? 19) === s.px })),
      ...UI_FONTS.map((f) => ({ id: `app.ui-font.${f.id}`, title: `Interface font: ${f.name}`, group: "App", keywords: ["text", "typeface"], run: () => useTheme.getState().setText({ ui: f.id }), isActive: () => (useTheme.getState().appearance.text?.ui ?? "system") === f.id })),
      ...(onAndroid
        ? []
        : UI_SIZES.map((s) => ({ id: `app.ui-size.${s.percent}`, title: `Interface size: ${s.name}`, group: "App", keywords: ["text", "bigger", "smaller", "zoom"], run: () => useTheme.getState().setText({ uiSize: s.percent }), isActive: () => (useTheme.getState().appearance.text?.uiSize ?? 100) === s.percent }))),
      { id: "app.theme", title: "Theme…", group: "App", keywords: ["colors", "light", "dark", "appearance"], run: () => useThemePicker.getState().set(true) },
      signedIn
        ? {
            id: "app.github.sign-out",
            title: "Sign out of GitHub",
            group: "App",
            run: () => void api.github.signOut().then((status) => queryClient.setQueryData(githubKey, status)),
          }
        : { id: "app.github.connect", title: "Connect to GitHub…", group: "App", keywords: ["sign in", "log in", "account"], run: () => useConnect.getState().show() },
      { id: "app.shortcuts", title: "Keyboard shortcuts", group: "App", keys: APP_KEYS[1]!.keys, run: () => useOverlay.getState().set("shortcuts") },
      { id: "app.identity", title: "Your name and email…", group: "App", keywords: ["git", "author", "identity", "signature"], run: () => useIdentityDialog.getState().show() },
      ...(dictation
        ? [{ id: "app.dictation", title: "Dictation settings…", group: "App", keywords: ["microphone", "voice", "speech", "model"], run: () => useDictationSettings.getState().set(true) }]
        : []),
      { id: "app.about", title: "About Writer", group: "App", keywords: ["version", "update", "licence", "license"], run: () => useAbout.getState().set(true) },
    ],
    [openNovel, showLibrary, novels, signedIn, queryClient, dictation, own],
  );
  return null;
}
