import { imageUrl, type LibraryEntry, type TextFile } from "@writer/client";
import { proseText, shownPictures, type Book, type Note } from "@writer/core";
import { splitSceneFile } from "@writer/editor";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api, keys } from "../api.ts";
import { refusal, savedSize } from "../bible/pictures.ts";
import { decodeImage, renderCrop } from "../bible/resize.ts";
import { realDay } from "../format.ts";
import { ErrorAlert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { Confirm } from "../ui/confirm.tsx";
import { cn } from "../ui/cn.ts";
import { markOpened, onShared, openedShares, pendingShares, pictureFile, shareDone, sharedLink, sharedMarkdown, sharedTitle, type Share } from "./shares.ts";

/**
 * Something shared with Writer from another app (#204) opens Save to Writer: what was shared before
 * the app started, as it starts, and what's shared while it's open, as it comes. Only what it hasn't
 * shown yet: one left for later (Not now, or Back) waits on the shelf, and the writer isn't sent back.
 */
export function ShareWatcher() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const here = useRef(pathname);
  here.current = pathname;
  // React Router's navigate changes with the page: looked at once, on start, and when something comes.
  const go = useRef(navigate);
  go.current = navigate;
  useEffect(() => {
    const look = () =>
      void pendingShares().then((shares) => {
        const opened = openedShares();
        if (shares.some((s) => !opened.has(s.id)) && here.current !== "/share") void go.current("/share");
      });
    look();
    return onShared(look);
  }, []);
  return null;
}

/** On the shelf, what's been shared and left for later, to save. */
export function SharesWaiting() {
  const [shares, setShares] = useState<Share[]>([]);
  useEffect(() => {
    const load = () => void pendingShares().then(setShares);
    load();
    return onShared(load);
  }, []);
  if (!shares.length) return null;
  return (
    <p className="mt-4 rounded-md border border-rule bg-raised px-3 py-2 text-sm">
      {shares.length === 1 ? "Something you shared with Writer isn't saved yet." : `${shares.length} things you shared with Writer aren't saved yet.`}{" "}
      <Link to="/share" className="text-accent underline underline-offset-[3px]">
        Save to Writer
      </Link>
    </p>
  );
}

/** A finger's size for every control here: 48 px. */
const FIELD = "min-h-12 w-full rounded-md border border-rule bg-raised px-3 text-base text-ink";

/**
 * Save to Writer (#205): what another app shared (#204) goes into a book on the shelf, the one used
 * last first: as a new note, its title filled in from what's shared, or at the end of a note, picked
 * from the book's newest first. Each picture is described, resized and saved in images/; a link stays
 * a link with its words, and nothing is fetched. It's written on the phone at once and synced with the
 * book; until it's written, the app keeps what was shared, to try again.
 */
export function SaveToWriterPage() {
  const [shares, setShares] = useState<Share[]>();
  useEffect(() => {
    const load = () =>
      void pendingShares().then((shares) => {
        markOpened(shares);
        setShares(shares);
      });
    load();
    return onShared(load);
  }, []);
  const share = shares?.[0];
  return (
    <main id="main" tabIndex={-1} className="mx-auto grid w-full max-w-2xl gap-5 px-4 py-6 outline-none">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">Save to Writer</h1>
        {shares && shares.length > 1 && <p className="text-sm text-muted">1 of {shares.length} things shared</p>}
      </div>
      {!shares ? (
        <p className="text-muted">Opening what was shared…</p>
      ) : share ? (
        <SaveShare key={share.id} share={share} onDone={() => setShares((s) => s?.slice(1))} />
      ) : (
        <p>
          Nothing to save. What you share with Writer from another app comes here.{" "}
          <Link to="/" className="text-accent underline underline-offset-[3px]">
            Your books
          </Link>
        </p>
      )}
    </main>
  );
}

function SaveShare({ share, onDone }: { share: Share; onDone: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ids = { book: useId(), title: useId(), into: useId(), search: useId(), notes: useId(), describe: useId(), missing: useId() };
  const library = useQuery({ queryKey: keys.library, queryFn: api.library });
  // The book used last first.
  const books = useMemo(() => [...(library.data?.novels ?? [])].sort((a, b) => b.lastOpened.localeCompare(a.lastOpened)), [library.data]);
  const [bookId, setBookId] = useState<string>();
  const book = bookId ?? books[0]?.id;
  const [into, setInto] = useState<"new" | "add">("new");
  const [title, setTitle] = useState(() => sharedTitle(share));
  const files = useMemo(() => share.pictures.map(pictureFile), [share]);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  const [descriptions, setDescriptions] = useState<string[]>(() => share.pictures.map(() => ""));
  const [noteId, setNoteId] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [missing, setMissing] = useState<string>();
  const link = sharedLink(share);
  const words = link ? link.words : share.text;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    // What's still to fill in, said, and the field it's in focused: a Save that did nothing wouldn't say why.
    const undescribed = descriptions.findIndex((d) => !d.trim());
    const gap: [string, HTMLElement | null | undefined] | undefined =
      undescribed >= 0
        ? [files.length > 1 ? `Describe picture ${undescribed + 1}.` : "Describe the picture.", document.getElementById(`${ids.describe}-${undescribed}`)]
        : !book
          ? ["Choose a book.", document.getElementById(ids.book)]
          : into === "new" && !title.trim()
            ? ["Give the note a title.", document.getElementById(ids.title)]
            : into === "add" && !noteId
              ? ["Choose the note to add it to.", document.getElementById(ids.notes)?.querySelector<HTMLElement>("input") ?? document.getElementById(ids.search)]
              : undefined;
    setMissing(gap?.[0]);
    if (gap || !book) {
      gap?.[1]?.focus();
      return;
    }
    setSaving(true);
    setProblem(undefined);
    try {
      const saved = [];
      for (const [i, file] of files.entries()) {
        const alt = descriptions[i]!.trim();
        saved.push({ url: `/${await savePicture(book, file, alt)}`, alt });
      }
      const markdown = sharedMarkdown(share, saved);
      const note = into === "new" ? (await api.notes.create(book, { title: title.trim(), note: markdown })).id : await addToNote(book, noteId!, markdown);
      await shareDone(share.id);
      await queryClient.invalidateQueries({ queryKey: keys.novel(book) });
      onDone();
      void navigate(`/novels/${encodeURIComponent(book)}/note/${encodeURIComponent(note)}`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  if (library.isPending) return <p className="text-muted">Opening your books…</p>;
  if (!books.length) return <p>There's no book on this phone to save it in. Start one, or clone one from GitHub, and share it again.</p>;
  return (
    <form noValidate onSubmit={(e) => void save(e)} className="grid gap-5">
      <section aria-label="What was shared" className="grid gap-3 rounded-lg border border-rule bg-raised p-4">
        {words && <p className="font-prose whitespace-pre-wrap">{words}</p>}
        {link && (
          <p className="flex items-center gap-2 break-all text-sm text-muted">
            <Link2 className="size-4 shrink-0" aria-hidden /> <span className="sr-only">Link: </span>
            {link.url}
          </p>
        )}
        {share.pictures.map((p, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start">
            <img src={previews[i]} alt="" className="max-h-40 w-full rounded-md border border-rule bg-panel object-contain sm:w-32" />
            <label className="grid gap-1.5 text-sm font-medium">
              {share.pictures.length > 1 ? `Description of picture ${i + 1}` : "Description of the picture"}
              <input
                id={`${ids.describe}-${i}`}
                required
                aria-invalid={missing !== undefined && !descriptions[i]!.trim() ? true : undefined}
                value={descriptions[i]}
                onChange={(e) => setDescriptions((d) => d.map((x, j) => (j === i ? e.target.value : x)))}
                aria-describedby={`${ids.title}-describe`}
                className={FIELD}
              />
              <span className="font-normal text-muted">{p.name}</span>
            </label>
          </div>
        ))}
        {share.pictures.length > 0 && (
          <p id={`${ids.title}-describe`} className="text-xs text-muted">
            What the picture shows, read aloud by screen readers in place of it.
          </p>
        )}
      </section>

      <label htmlFor={ids.book} className="grid gap-1.5 text-sm font-medium">
        Book
        <select id={ids.book} value={book} onChange={(e) => (setBookId(e.target.value), setNoteId(undefined))} className={FIELD}>
          {books.map((b: LibraryEntry) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Save it as</legend>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name={ids.into} checked={into === "new"} onChange={() => setInto("new")} className="size-5" />
          New note
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name={ids.into} checked={into === "add"} onChange={() => setInto("add")} className="size-5" />
          Add to a note…
        </label>
      </fieldset>

      {into === "new" ? (
        <label htmlFor={ids.title} className="grid gap-1.5 text-sm font-medium">
          Title
          <input id={ids.title} required aria-invalid={missing !== undefined && !title.trim() ? true : undefined} value={title} onChange={(e) => setTitle(e.target.value)} className={FIELD} />
        </label>
      ) : (
        book && <NotePicker bookId={book} value={noteId} onChange={setNoteId} searchId={ids.search} listId={ids.notes} />
      )}

      {problem && (
        <ErrorAlert title="Couldn't save it">
          {problem} What was shared is kept: try again.
        </ErrorAlert>
      )}
      <p id={ids.missing} role="alert" className="text-sm font-medium text-danger empty:hidden">
        {missing}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button className="min-h-12" onClick={() => setDiscarding(true)} disabled={saving}>
          Discard
        </Button>
        <Button className="min-h-12" onClick={() => void navigate("/")} disabled={saving}>
          Not now
        </Button>
        <Button type="submit" variant="primary" className="min-h-12 px-5" aria-describedby={missing ? ids.missing : undefined} disabled={saving}>
          {saving ? "Saving…" : into === "new" ? "Save as a new note" : "Add to the note"}
        </Button>
      </div>
      <Confirm
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard what was shared?"
        description="It isn't saved anywhere in Writer. To keep it, share it again."
        action="Discard"
        danger
        onConfirm={() => void shareDone(share.id).then(onDone)}
      />
    </form>
  );
}

/** The book's notes, newest first, with a search, and each note's first picture: one to add to. */
function NotePicker({ bookId, value, onChange, searchId, listId }: { bookId: string; value: string | undefined; onChange: (id: string) => void; searchId: string; listId: string }) {
  const novel = useQuery({ queryKey: keys.novel(bookId), queryFn: () => api.novel<Book>(bookId) });
  const [query, setQuery] = useState("");
  const name = useId();
  const q = query.trim().toLowerCase();
  const notes = useMemo(
    () => [...(novel.data?.novel.notes ?? [])].sort((a, b) => (b.created ?? "").localeCompare(a.created ?? "") || a.title.localeCompare(b.title)),
    [novel.data],
  );
  const shown = notes.filter((n) => !q || [n.title, proseText(n.body), ...n.tags].some((t) => t.toLowerCase().includes(q)));
  if (novel.isPending) return <p className="text-muted">Opening the notes…</p>;
  if (!notes.length) return <p>This book has no notes yet: save it as a new note.</p>;
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">The note</legend>
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search the notes
        </label>
        <Search className="pointer-events-none absolute top-3.5 left-3 size-5 text-muted" aria-hidden />
        <input id={searchId} type="search" placeholder="Search the notes" value={query} onChange={(e) => setQuery(e.target.value)} className={cn(FIELD, "pl-10")} />
      </div>
      <ul id={listId} className="grid max-h-[50vh] gap-1 overflow-y-auto" aria-label="Notes, newest first">
        {shown.map((n) => (
          <li key={n.id}>
            <NoteChoice bookId={bookId} note={n} name={name} checked={value === n.id} onChange={() => onChange(n.id)} />
          </li>
        ))}
      </ul>
      {!shown.length && <p className="text-sm text-muted">No note matches.</p>}
    </fieldset>
  );
}

function NoteChoice({ bookId, note, name, checked, onChange }: { bookId: string; note: Note; name: string; checked: boolean; onChange: () => void }) {
  const first = shownPictures(note.body)[0];
  return (
    <label className={cn("flex min-h-12 items-center gap-3 rounded-md border px-3 py-2", checked ? "border-accent bg-accent-soft" : "border-rule")}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="size-5 shrink-0" />
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-medium">{note.title}</span>
        {note.created && <span className="text-xs text-muted">{realDay(note.created)}</span>}
      </span>
      {first && <img src={imageUrl(bookId, first.path)} alt="" loading="lazy" className="size-12 shrink-0 rounded object-cover" />}
    </label>
  );
}

/** A shared picture resized as any other (D10) and saved in the book's images/, named for its description: its path. */
async function savePicture(bookId: string, file: File, description: string): Promise<string> {
  const refused = refusal(file, "book");
  if (refused) throw new Error(refused);
  const bitmap = await decodeImage(file);
  try {
    const size = savedSize(bitmap);
    const rendered = await renderCrop(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height }, size.width, size.height, { keepTransparency: file.type !== "image/jpeg" });
    return (await api.addPicture(bookId, rendered.blob, description)).path;
  } finally {
    bitmap.close();
  }
}

/**
 * `markdown` at the end of the note `noteId`, after what's in its file now, which is otherwise left as
 * it is, byte for byte. Written as the editor's autosave writes, only if the file is still the one
 * read: changed meanwhile (an edit saved from the note's page), it's added to what's there now, so no
 * word of either is lost. Its ID.
 */
async function addToNote(bookId: string, noteId: string, markdown: string): Promise<string> {
  const book = (await api.novel<Book>(bookId)).novel;
  const note = book.notes.find((n) => n.id === noteId);
  if (!note) throw new Error("That note is gone.");
  let file: TextFile | null = await api.readFile(bookId, note.file);
  for (let tries = 0; file && tries < 3; tries++) {
    const content = `${file.content.trimEnd()}${splitSceneFile(file.content).body.trim() ? "\n\n" : "\n"}${markdown}`;
    const written = await api.writeFile(bookId, note.file, content, file.hash);
    if (written.ok) return noteId;
    file = written.current;
  }
  throw new Error(file ? "The note kept changing as it was added to." : "That note is gone.");
}
