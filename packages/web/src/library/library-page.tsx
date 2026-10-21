import { coverUrl, type LibraryEntry } from "@writer/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, GitBranch, MoreHorizontal, Plus, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { api, keys } from "../api.ts";
import { useCommands, type Command } from "../commands.ts";
import { webModulesByIds, type ShelfAction } from "../modules.tsx";
import { desktop, useOpenNovel } from "../desktop.ts";
import { ago, remoteLabel } from "../format.ts";
import { Shell } from "../layout.tsx";
import { ErrorAlert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { Confirm } from "../ui/confirm.tsx";
import { usePublish } from "../github/publish.tsx";
import { usePictureFlow } from "../bible/picture.tsx";
import { SHAPES } from "../bible/pictures.ts";
import { CloneDialog, NewNovelDialog, OpenFolderDialog } from "./add-dialogs.tsx";
import { Cover } from "./cover.tsx";

export type AddMode = "new" | "open" | "clone";
const MODES: AddMode[] = ["new", "open", "clone"];

/**
 * The author's novels as books on a shelf. A new novel, a folder already on this computer, or a
 * clone from GitHub join it through dialogs, opened here or from the palette (?add=new|open|clone).
 */
export function LibraryPage() {
  const library = useQuery({ queryKey: keys.library, queryFn: api.library });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const notices = library.data?.notices.filter((n) => !dismissed.includes(n.path)) ?? [];
  const [params, setParams] = useSearchParams();
  const adding = MODES.find((m) => m === params.get("add"));
  const add = (mode: AddMode | undefined) => setParams(mode ? { add: mode } : {}, { replace: !mode });
  const close = () => add(undefined);
  // Book menus open inside the page's landmarks (not at the end of body).
  const [menus, setMenus] = useState<HTMLElement | null>(null);
  // What the books' modules offer from the shelf (Today's entry), in the palette: for each book, and
  // under the action's own command for the one opened last (books come most recent first), so the
  // desktop menu's item works from here too.
  const openNovel = useOpenNovel();
  useCommands(
    (): Command[] => {
      const offered = (library.data?.novels ?? []).flatMap((n) => shelfActions(n).map((a) => ({ n, a })));
      const latest = new Map<string, { n: LibraryEntry; a: ShelfAction }>();
      for (const o of offered) if (!latest.has(o.a.command)) latest.set(o.a.command, o);
      return [
        ...offered.map(({ n, a }) => ({ id: `${a.command}.${n.id}`, title: `${a.label}: ${n.title}`, group: "Your books", run: () => openNovel(n.id, a.path) })),
        ...[...latest.values()].map(({ n, a }) => ({ id: a.command, title: `${a.label} (${n.title})`, group: "Your books", run: () => openNovel(n.id, a.path) })),
      ];
    },
    [library.data, openNovel],
  );

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Your books</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => add("new")}>
            <Plus className="size-4" aria-hidden /> New book
          </Button>
          <Button onClick={() => add("open")}>
            <FolderOpen className="size-4" aria-hidden /> Open a folder
          </Button>
          <Button onClick={() => add("clone")}>
            <GitBranch className="size-4" aria-hidden /> Clone from GitHub
          </Button>
        </div>
      </div>

      {notices.length > 0 && (
        <ul className="mt-4 grid gap-2" aria-label="Notices">
          {notices.map((n) => (
            <li key={n.path} className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-sm">
              <p className="flex-1">{n.message}</p>
              <Button variant="ghost" size="sm" aria-label={`Dismiss: ${n.message}`} onClick={() => setDismissed((d) => [...d, n.path])}>
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <FromGhWriter books={library.data?.ghWriter ?? []} />

      <section ref={setMenus} aria-labelledby="shelf-heading" className="mt-8">
        <h2 id="shelf-heading" className="mb-4 text-sm font-medium tracking-[0.14em] text-muted uppercase">
          Works in progress
        </h2>
        {library.isPending ? (
          <p className="text-muted" role="status">
            Loading your library…
          </p>
        ) : library.isError ? (
          <ErrorAlert title="Couldn't load your library">{library.error.message}</ErrorAlert>
        ) : (
          <>
            {library.data.novels.length === 0 && (
              <p className="mb-4 text-sm text-muted">
                <span className="font-medium text-ink">No books yet.</span> Start one, open a book you already have on this computer, or clone one from GitHub.
              </p>
            )}
            <Shelf>
              {library.data.novels.map((novel) => (
                <Book key={novel.id} novel={novel} menus={menus} />
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => add("new")}
                  title="New book"
                  className="grid aspect-[2/3] w-36 place-items-center rounded-[2px_5px_5px_2px] border-2 border-dashed border-rule text-muted transition-colors hover:border-muted hover:text-ink"
                >
                  <Plus className="size-7" strokeWidth={1.5} aria-hidden />
                  <span className="sr-only">New book</span>
                </button>
              </li>
            </Shelf>
          </>
        )}
      </section>

      {adding === "new" && <NewNovelDialog folder={library.data?.folder} authors={library.data?.novels.flatMap((n) => (n.author ? [n.author] : [])) ?? []} kinds={library.data?.kinds ?? []} onClose={close} />}
      {adding === "open" && <OpenFolderDialog onClose={close} initial={params.get("path") ?? undefined} />}
      {adding === "clone" && <CloneDialog folder={library.data?.folder} onClose={close} />}
    </Shell>
  );
}

/**
 * The shelf: books stand on a plank that runs the width of every row. Rows have a fixed height, so
 * the planks are one repeating background behind the grid.
 */
function Shelf({ children }: { children: ReactNode }) {
  // A cover is 9rem × 13.5rem; the plank is under it, the caption under the plank.
  const plank = [
    "linear-gradient(to bottom, transparent 13.5rem, var(--ghw-shelf) 13.5rem, var(--ghw-shelf) 14.1rem, var(--ghw-shelf-edge) 14.1rem, var(--ghw-shelf-edge) 14.3rem, rgb(0 0 0 / 0.1) 14.3rem, transparent 15rem)",
  ].join(", ");
  return (
    <ul
      aria-label="Books"
      className="grid grid-cols-[repeat(auto-fill,9rem)] auto-rows-[17.5rem] justify-between gap-x-6 gap-y-6 px-3 sm:justify-start sm:gap-x-8"
      style={{ backgroundImage: plank, backgroundSize: "100% 19rem", backgroundRepeat: "repeat-y" }}
    >
      {children}
    </ul>
  );
}

/** gh-writer's books that aren't on this shelf (#2): brought in as they are, their folders, not copies. */
function FromGhWriter({ books }: { books: { path: string; title: string }[] }) {
  const queryClient = useQueryClient();
  const [said, setSaid] = useState<string>();
  const bring = useMutation({
    mutationFn: api.importGhWriter,
    onSuccess: async ({ added, failed }) => {
      await queryClient.invalidateQueries({ queryKey: keys.library });
      const brought = `Brought in ${added.length === 1 ? `“${added[0]!.title}”` : `${added.length} books`} from gh-writer.`;
      setSaid([brought, ...failed.map((f) => `${f.path} couldn't be: ${f.error}`)].join(" "));
    },
    onError: (e) => setSaid(`Couldn't bring them in: ${e instanceof Error ? e.message : String(e)}`),
  });
  if (!books.length && !said) return null;
  const one = books.length === 1;
  return (
    <section aria-label="Books in gh-writer" className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-rule bg-raised px-3 py-2 text-sm">
      {said ? (
        <p role="status" className="flex-1">
          {said}
        </p>
      ) : (
        <>
          <p className="flex-1">
            gh-writer has {one ? `“${books[0]!.title}”` : `${books.length} books`} that {one ? "isn't" : "aren't"} on this shelf. Writer can open {one ? "it" : "them"} as {one ? "it is" : "they are"}, in the same {one ? "folder" : "folders"}.
          </p>
          <Button size="sm" disabled={bring.isPending} onClick={() => bring.mutate()}>
            Bring {one ? "it" : "them"} in
          </Button>
        </>
      )}
    </section>
  );
}

function Book({ novel, menus }: { novel: LibraryEntry; menus: HTMLElement | null }) {
  const openNovel = useOpenNovel();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.removeNovel(novel.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.library }),
  });
  // The book's own cover (heffrey78/gh-writer#168), set or changed from its menu, as from Compile.
  const shown = () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.library }), queryClient.invalidateQueries({ queryKey: keys.novel(novel.id) })]);
  const cover = usePictureFlow({
    // The shelf holds books of every kind: it says "book" (#22).
    book: "book",
    name: novel.title,
    shape: SHAPES.cover,
    onSave: async (picture) => {
      await api.setCover(novel.id, picture);
      await shown();
    },
  });
  const [removingCover, setRemovingCover] = useState(false);
  const item = "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent-soft";
  return (
    <li className="flex min-w-0 flex-col">
      <Link
        to={`/novels/${novel.id}`}
        onClick={(e) => {
          // In the desktop app, a novel opens in a window of its own.
          if (!desktop) return;
          e.preventDefault();
          openNovel(novel.id);
        }}
        className="block w-fit rounded-[2px_5px_5px_2px] transition-transform hover:-translate-y-1 focus-visible:-translate-y-1" title={novel.path} aria-label={novel.author ? `${novel.title}, by ${novel.author}` : novel.title}>
        <Cover id={novel.id} title={novel.title} author={novel.author} image={coverUrl(novel)} />
      </Link>
      <div className="mt-[1.4rem] flex items-start gap-1">
        <div className="min-w-0 flex-1 text-xs leading-4">
          <p className="truncate text-ink" title={novel.remote}>
            {novel.remote ? remoteLabel(novel.remote) : "Not on GitHub yet"}
          </p>
          <p className="text-muted">Opened {ago(novel.lastOpened)}</p>
          {shelfActions(novel).map((a) => (
            <button key={a.command} type="button" onClick={() => openNovel(novel.id, a.path)} className="mt-1 text-accent underline-offset-2 hover:underline">
              {a.label}
            </button>
          ))}
        </div>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" size="sm" className="-mt-1 -mr-2 px-1.5" aria-label={`More for “${novel.title}”`}>
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={menus}>
            <DropdownMenu.Content align="end" className="z-50 grid w-72 rounded-md border border-rule bg-raised p-1 text-ink shadow-lg">
              <DropdownMenu.Label className="px-2 pt-1.5 text-xs text-muted">Folder</DropdownMenu.Label>
              <DropdownMenu.Label className="px-2 pb-1.5 font-mono text-xs break-all select-text">{novel.path}</DropdownMenu.Label>
              <DropdownMenu.Separator className="my-1 h-px bg-rule" />
              <DropdownMenu.Item className={item} onSelect={() => openNovel(novel.id)}>
                Open
              </DropdownMenu.Item>
              {shelfActions(novel).map((a) => (
                <DropdownMenu.Item key={a.command} className={item} onSelect={() => openNovel(novel.id, a.path)}>
                  {a.label}
                </DropdownMenu.Item>
              ))}
              {!novel.remote && (
                <DropdownMenu.Item className={item} onSelect={() => usePublish.getState().show({ id: novel.id, folder: novel.path })}>
                  Put on GitHub…
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item className={item} onSelect={cover.choose}>
                {novel.cover ? "Change the cover…" : "Set a cover…"}
              </DropdownMenu.Item>
              {novel.cover && (
                <DropdownMenu.Item className={item} onSelect={() => setRemovingCover(true)}>
                  Remove the cover…
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Separator className="my-1 h-px bg-rule" />
              <DropdownMenu.Item className={item} onSelect={() => setRemoving(true)}>
                Remove from library…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {cover.element}
      {cover.problem && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {cover.problem}
        </p>
      )}
      <Confirm
        open={removingCover}
        onOpenChange={setRemovingCover}
        title={`Remove the cover of “${novel.title}”?`}
        description="The shelf shows a generated cover again, and e-books and PDFs go out without one. Its file is deleted from images/; the book's history keeps it."
        action="Remove"
        danger
        onConfirm={() => void api.removeCover(novel.id).then(shown, (e: unknown) => cover.setProblem(e instanceof Error ? e.message : String(e)))}
      />
      <Confirm
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove “${novel.title}” from your library?`}
        description="Its folder and files stay where they are; you can add it again at any time."
        action="Remove"
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

/** What a book's modules offer on its tile: Today's entry, for a journal. */
const shelfActions = (novel: LibraryEntry): ShelfAction[] => webModulesByIds(novel.modules ?? []).flatMap((m) => m.shelfActions ?? []);
