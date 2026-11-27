import type { EntityFields, Reference } from "@writer/client";
import { referenceText } from "./references.ts";
import { entityOfLabel, fieldsOfType, notesMentioning, roleOf, vocabulary, type Entity, type Book, type Relationship } from "@writer/core";
import { useGitHubRepo } from "../github/repo.ts";
import { EntryIssues } from "../issues/entry-issues.tsx";
import { useIssueList } from "../issues/use-issues.ts";
import { useNotice } from "../novel/notice.tsx";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Merge, Trash2 } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { startTransition, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, keys } from "../api.ts";
import { ModulePageActions } from "../modules.tsx";
import type { Workspace } from "../novel/workspace.ts";
import { ErrorAlert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { Picture, PictureSlot, usePictureUrl } from "./picture.tsx";
import { pictureAlt, shapeForType } from "./pictures.ts";
import { AddButton, Lead, PencilButton, TextEditor, useInPlace } from "./profile.tsx";
import { EntryFields, NamedBy } from "./entry-fields.tsx";
import { useMergeDialog } from "./merge-dialog.tsx";
import { useCommands } from "../commands.ts";
import { useCurrentScene } from "../novel/current.ts";
import { RelationshipArcs } from "./arcs.tsx";
import { NotesAbout } from "../notes/notes-about.tsx";
import { InTheStory } from "./strip.tsx";
import { AppearsIn, usePassages } from "./appears-in.tsx";
import { QuotesFrom } from "./quotes-from.tsx";
import { TypeSections } from "./type-sections.tsx";
import { typeOf } from "./types.ts";
import { useEntryNotesMove } from "../novel/new-format.tsx";



/**
 * A bible entry as a profile (heffrey78/gh-writer#158), read first: its type, tags, name and other names, a portrait,
 * the summary as a lead, its fields as rows, what names it in theirs (Links), then the notes that
 * mention it, issues, scenes and relationships. Each part edits in place from its pencil (or "+ Add…"
 * while empty), saved to the entry's file at once. An entry has no notes of its own (D20): what's said
 * about it is in the book's notes that mention it.
 */
export function EntryPage({
  novelId,
  novel,
  entity,
  workspace,
  embedded,
  startEditing,
  size = "page",
}: {
  novelId: string;
  novel: Book;
  entity: Entity;
  workspace: Workspace;
  /** Shown beside the text, or beside the index's list (#134): its name is a level-2 heading with this ID, and it takes the panel's width. */
  embedded?: { headingId: string; /** The page's own top heading: the index's list isn't showing beside it. */ modal?: boolean };
  /** A part to open for editing at once ("name" after a quick entry's Add details). */
  startEditing?: "name";
  /**
   * How much it shows: the whole page, or the right sidebar's Entry tab (heffrey78/gh-writer#163), which shows the
   * picture (heffrey78/gh-writer#168) without its slot, leaves out delete, issues and the type's own sections, and links to the page instead.
   */
  size?: "page" | "tab";
}) {
  const tab = size === "tab";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const type = typeOf(novel, entity);
  /** How a piece refers to it, in the kind's words: a field's role ("point of view", "set here"), or a mention. */
  const via = (link: string) => {
    const f = novel.kind.fields.find((x) => x.key === link);
    return f ? roleOf(f) : link === "mention" ? "mentioned" : link;
  };
  const ids = { parts: useId(), left: useId() };
  const part = (name: string) => `${ids.parts}-${name}`;
  // Beside the index's list, the parts under the fields are drawn once the writer stops on the entry
  // (#177): stepping through a long index, the next entry's name, lead and fields answer at once, and
  // an entry passed over on the way isn't drawn whole.
  const [rest, setRest] = useState(!embedded || tab);
  useEffect(() => {
    if (rest) return;
    const t = setTimeout(() => startTransition(() => setRest(true)), 120);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const passages = usePassages(novel, rest ? entity.id : undefined);
  const relationships = novel.relationships.filter((r) => r.from === entity.id || r.to === entity.id).length;
  const notes = useMemo(() => notesMentioning(novel, entity.id), [novel, entity.id]);
  const place = useInPlace(startEditing);
  // Read at one piece (#140): its fields and its relationships as they are there. Beside the text, the
  // piece being written; in the index, the whole book.
  const writing = useCurrentScene((s) => s.scene?.id);
  const [readAt, setReadAt] = useState<string | undefined>(() => (tab ? writing : undefined));
  useEffect(() => {
    if (tab && writing) setReadAt(writing);
  }, [tab, writing]);
  const shape = shapeForType(entity.type);
  const picture = usePictureUrl(novelId, entity.image);

  useEffect(() => void workspace.open([entity.file]), [workspace, entity.file]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
  /** The file's current hash, after any change still being saved. */
  const base = async () => {
    await workspace.autosave.flush();
    return workspace.store.getState().files[entity.file]?.hash ?? "";
  };
  /**
   * Save some of the entry's details, then reload the book; throws to say why it couldn't. One at a
   * time: each is based on the file as the one before left it (read back at once, not when the
   * change is heard of), so two parts saved in quick succession don't refuse each other.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const save = (operation: (base: string) => Promise<{ file: string }>) => {
    const run = queue.current.then(async () => {
      const { file: path } = await operation(await base());
      if (path === entity.file) await workspace.fileChanged({ type: "change", path, hash: null });
      else await workspace.open([path]);
      await refresh();
    });
    queue.current = run.catch(() => undefined);
    return run;
  };
  const change = (changes: EntityFields) => save((b) => api.bible.updateEntity(novelId, entity.id, b, changes));
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  const [references, setReferences] = useState<Reference[]>();
  // On GitHub, the entry's label (if it's there): offered for removal when the entry goes.
  const repo = useGitHubRepo(novelId);
  const githubLabel = useIssueList(novelId, { state: "open" }, { enabled: !!repo }).data?.labels.find((l) => entityOfLabel(novel, l)?.id === entity.id);
  const show = useNotice((n) => n.show);
  // Merging the entry on its profile is a command, as its button is (#173).
  // Read at a piece (#140), where its fields change: the list of pieces to read it at, in focus.
  const changing = fieldsOfType(novel, entity.type).some((f) => f.changes) || (entity.changes?.length ?? 0) > 0;
  useCommands(
    () =>
      tab
        ? []
        : [
            { id: "entry.merge", title: `Merge ${entity.name} into another ${typeOf(novel, entity)?.label.toLowerCase() ?? vocabulary(novel.kind).entity.one}…`, group: vocabulary(novel.kind).codex.One, keywords: ["duplicate", "same", "combine"], run: () => useMergeDialog.getState().open(entity.id) },
            ...(changing ? [{ id: "entry.readAt", title: `Read ${entity.name} at a ${vocabulary(novel.kind).piece.one}…`, group: vocabulary(novel.kind).codex.One, keywords: ["as of", "then", "changes", "time"], run: () => document.querySelector<HTMLSelectElement>("[data-read-at]")?.focus() }] : []),
          ],
    [tab, entity.id, entity.name, changing],
  );
  const remove = useMutation({
    mutationFn: async (confirm: boolean) => api.bible.deleteEntity(novelId, entity.id, await base(), confirm),
    onSuccess: async (result) => {
      if (!result.ok) return setReferences(result.references);
      setReferences(undefined);
      await refresh();
      void navigate(`/novels/${novelId}/bible`);
      if (repo && githubLabel) {
        show({
          message: `Deleted “${entity.name}”. Its label ${githubLabel.name} is still on GitHub, on its issues.`,
          action: {
            label: "Remove label",
            run: () =>
              void api.issues
                .deleteLabel(novelId, githubLabel.name)
                .then(() => show({ message: `Removed the label ${githubLabel.name} from GitHub.` }))
                .catch((e: unknown) => show({ message: `Couldn't remove the label: ${e instanceof Error ? e.message : String(e)}` }))
                .finally(() => void queryClient.invalidateQueries({ queryKey: keys.issues(novelId) })),
          },
        });
      }
    },
  });

  const Heading = embedded && !embedded.modal ? "h2" : "h1";
  return (
    <div className={embedded ? (tab ? "grid gap-4" : "grid gap-5") : "mx-auto grid w-full max-w-[calc(var(--ghw-prose-measure)+3rem)] gap-5 px-6 py-6"}>
      <div id={part("profile")} className="flex scroll-mt-12 flex-wrap items-start gap-4">
        {tab ? (
          picture && <Picture src={picture} alt={pictureAlt(shape, entity.name)} focus={entity.imageFocus} className={shape.key === "wide" ? "aspect-video w-32 shrink-0 rounded-md" : "h-[110px] w-[88px] shrink-0 rounded-md"} />
        ) : (
          <PictureSlot
            novelId={novelId}
            name={entity.name}
            shape={shape}
            image={entity.image}
            focus={entity.imageFocus}
            onSave={(image, focus) => save((b) => api.bible.setPicture(novelId, entity.id, b, image, focus))}
            onRemove={() => save((b) => api.bible.removePicture(novelId, entity.id, b))}
          />
        )}
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
          {/* On a phone, the actions are their icons (named for a screen reader and on hover): beside a portrait there's no room for their words. */}
          {!tab && <div className={cn("flex items-center gap-2", embedded && "pr-8 max-md:pr-0")}>
            <p className="min-w-0 flex-1 truncate text-sm text-muted">
              <Link to={`/novels/${novelId}/bible`} className="underline-offset-2 hover:underline">
                {vocabulary(novel.kind).codex.One}
              </Link>{" "}
              · {type?.label ?? entity.type}
            </p>
            <Button variant="ghost" size="sm" onClick={() => useMergeDialog.getState().open(entity.id)} title="Merge into…" className="max-md:size-11 max-md:px-0">
              <Merge className="size-4" aria-hidden /> <span className="max-md:sr-only">Merge into…</span>
            </Button>
            <ModulePageActions novelId={novelId} novel={novel} subject={{ entity }} className="max-md:size-11 max-md:px-0" labelClassName="max-md:sr-only" />
            <Button variant="ghost" size="sm" onClick={() => remove.mutate(false)} disabled={remove.isPending} title="Delete" className="max-md:size-11 max-md:px-0">
              <Trash2 className="size-4" aria-hidden /> <span className="max-md:sr-only">Delete</span>
            </Button>
          </div>}

          {place.editing === "name" ? (
            <>
              {/* Still the page's (or panel's) heading while it's edited. */}
              <Heading id={embedded?.headingId} className="sr-only">
                {entity.name}
              </Heading>
              <TextEditor place={place} label="Name" value={entity.name} required onSave={(name) => change({ name })} />
            </>
          ) : (
            <div className="group flex items-center gap-1">
              <Heading id={embedded?.headingId} className={embedded && !embedded.modal ? "text-xl font-semibold" : "text-2xl font-semibold"}>
                {entity.name}
              </Heading>
              <PencilButton place={place} part="name" label="name" />
            </div>
          )}

          {place.editing === "aliases" ? (
            <TextEditor place={place} label="Other names" hint="Separated by commas. Recognised when suggesting mentions." value={entity.aliases.join(", ")} onSave={(v) => change({ aliases: list(v) })} />
          ) : entity.aliases.length ? (
            <div className="group flex items-center gap-1 text-sm text-muted">
              <span>Also {entity.aliases.join(", ")}</span>
              <PencilButton place={place} part="aliases" label="other names" />
            </div>
          ) : (
            <AddButton place={place} part="aliases">
              Add other names
            </AddButton>
          )}

          {place.editing === "tags" ? (
            <TextEditor place={place} label="Tags" hint="Separated by commas." value={entity.tags.join(", ")} onSave={(v) => change({ tags: list(v) })} />
          ) : entity.tags.length ? (
            <div className="group flex flex-wrap items-center gap-1.5">
              <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
                {entity.tags.map((t) => (
                  <li key={t} className="rounded-full border border-rule px-2 py-0.5 text-xs">
                    {t}
                  </li>
                ))}
              </ul>
              <PencilButton place={place} part="tags" label="tags" />
            </div>
          ) : (
            <AddButton place={place} part="tags">
              Add tags
            </AddButton>
          )}
        </div>
      </div>

      {place.editing === "summary" ? (
        <TextEditor place={place} label="Summary" multiline value={entity.summary ?? ""} onSave={(v) => change({ summary: v || null })} />
      ) : entity.summary ? (
        <div className="group flex items-start gap-1">
          <div className="flex-1">
            <Lead size={tab ? "tab" : "page"}>{entity.summary}</Lead>
          </div>
          <PencilButton place={place} part="summary" label="summary" />
        </div>
      ) : (
        <AddButton place={place} part="summary">
          Add a summary
        </AddButton>
      )}

      <EntryFields novelId={novelId} novel={novel} entity={entity} place={place} save={change} compact={tab} at={readAt} onAt={setReadAt} heading={Heading === "h1" ? "h2" : "h3"} />
      <NamedBy novelId={novelId} novel={novel} entity={entity} compact={tab} />

      {rest && !tab && (
        <PartsStrip
          label={`Parts of the ${vocabulary(novel.kind).entity.one}`}
          parts={[
            { id: part("profile"), label: "Profile" },
            ...(notes.length ? [{ id: part("notes"), label: `In your notes · ${notes.length}` }] : []),
            { id: part("story"), label: `In the ${vocabulary(novel.kind).subject}` },
            { id: part("passages"), label: `Appears in · ${passages.length}` },
            { id: part("relationships"), label: `Relationships · ${relationships}` },
          ]}
        />
      )}

      {rest && <>
      {entity.body.trim() && (
        // Notes still in the entry's file, from before D20: shown as they are until they're moved, so no word is out of sight.
        <section aria-labelledby={ids.left} className="grid gap-2 rounded-md border border-rule bg-panel p-3">
          <h2 id={ids.left} className="text-xs font-semibold tracking-wide text-muted uppercase">
            Notes kept in the {vocabulary(novel.kind).entity.one}'s file
          </h2>
          <p className="max-h-48 overflow-y-auto font-prose text-[15px] whitespace-pre-wrap [overflow-wrap:anywhere]">{entity.body.trim()}</p>
          <p className="text-sm text-muted">
            Writer keeps what you write about {vocabulary(novel.kind).entity.a} in your notes now.{" "}
            <Button variant="ghost" size="sm" onClick={() => useEntryNotesMove.getState().ask()} className="-my-1 px-1 text-accent underline">
              Move them into your notes…
            </Button>
          </p>
        </section>
      )}
      <NotesAbout novelId={novelId} novel={novel} id={entity.id} notes={notes} sectionId={part("notes")}>
        <QuotesFrom novelId={novelId} novel={novel} body={notes.map((n) => n.body).join("\n\n")} />
      </NotesAbout>

      {!tab && <EntryIssues novelId={novelId} novel={novel} entity={entity} />}

      <InTheStory novelId={novelId} novel={novel} entity={entity} compact={tab} id={part("story")} />
      <AppearsIn novelId={novelId} novel={novel} entity={entity} workspace={workspace} passages={passages} compact={tab} id={part("passages")} />
      {!tab && <TypeSections novelId={novelId} novel={novel} entity={entity} workspace={workspace} />}

      <RelationshipArcs novelId={novelId} novel={novel} entity={entity} compact={tab} id={part("relationships")} readAt={readAt} onReadAt={setReadAt} />
      </>}
      {tab && (
        <Link to={`/novels/${novelId}/bible/${entity.id}`} className="justify-self-start text-sm text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent">
          Open the full {vocabulary(novel.kind).entity.one}
        </Link>
      )}

      <AlertDialog.Root open={references !== undefined} onOpenChange={(o) => !o && setReferences(undefined)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-[60] grid max-h-[80vh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-3 overflow-y-auto rounded-lg border border-rule bg-raised p-5 text-ink shadow-xl">
            <AlertDialog.Title className="text-base font-semibold">Delete “{entity.name}”? The {vocabulary(novel.kind).subject} still refers to it.</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted">These will point at {vocabulary(novel.kind).entity.a} that no longer exists, and the validator will list them until they're changed:</AlertDialog.Description>
            <ul className="grid gap-1 text-sm">
              {references?.map((r) => (
                <li key={`${r.kind}:${r.id}`}>
                  {referenceText(novel, r, via)}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button>Keep it</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button variant="danger" onClick={() => remove.mutate(true)}>
                  Delete anyway
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      {remove.isError && <ErrorAlert title="Couldn't delete it">{remove.error.message}</ErrorAlert>}
    </div>
  );
}

/**
 * The profile's parts as a strip that stays at the top as it scrolls (mockup 1): each jumps to its
 * part, the focus on the part's heading, and the one being read is marked. On a phone it stays under
 * the index's top bar (its height in --ghw-sticky-top, #176).
 */
function PartsStrip({ label, parts }: { label: string; parts: { id: string; label: string }[] }) {
  const [reading, setReading] = useState(parts[0]?.id);
  const key = parts.map((p) => p.id).join(" ");
  const nav = useRef<HTMLElement>(null);
  /** How far down the screen the strip ends while it's stuck: what a part arrived at sits under. */
  const under = () => (nav.current ? (parseFloat(getComputedStyle(nav.current).top) || 0) + nav.current.offsetHeight : 48);
  // A part jumped to stays the one marked while the page moves to it, even where the page ends before it reaches the top.
  const jumped = useRef(0);
  useEffect(() => {
    const showing = new Map<string, boolean>();
    // A part is being read while it crosses the top half of the screen, under the strip.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) showing.set(e.target.id, e.isIntersecting);
        const first = parts.find((p) => showing.get(p.id));
        if (first && performance.now() - jumped.current > 1000) setReading(first.id);
      },
      // From what's written, not measured: measuring here would lay the whole page out again as each entry opens.
      { rootMargin: `-${Math.round((parseFloat(nav.current?.closest<HTMLElement>("#index-entry")?.style.getPropertyValue("--ghw-sticky-top") ?? "") || 0) + 48)}px 0px -50% 0px` },
    );
    for (const p of parts) {
      const el = document.getElementById(p.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [key]);
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    jumped.current = performance.now();
    el.style.scrollMarginTop = `${under() + 8}px`;
    el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    // Its heading takes the focus, so a screen reader says which part it is and reading goes on from there.
    const heading = el.querySelector<HTMLElement>("h1, h2, h3") ?? el;
    if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    setReading(id);
  };
  return (
    <nav ref={nav} aria-label={label} style={{ top: "var(--ghw-sticky-top, 0px)" }} className="sticky z-10 -my-2 flex gap-1 overflow-x-auto border-b border-rule bg-paper py-1.5 [scrollbar-width:none]">
      {parts.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-current={reading === p.id ? "true" : undefined}
          onClick={() => go(p.id)}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1 text-xs whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none max-md:min-h-11 max-md:px-3 max-md:text-sm",
            reading === p.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-accent-soft/50 hover:text-ink",
          )}
        >
          {p.label}
        </button>
      ))}
    </nav>
  );
}

/** "Rival of Ben Varn, from “The Betrayal”", read from this entry's side. */
export { describeRelationship as describe } from "@writer/core/diagrams";
