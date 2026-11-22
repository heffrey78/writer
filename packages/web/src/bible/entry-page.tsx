import type { EntityFields, Reference } from "@writer/client";
import { referenceText } from "./references.ts";
import { entityOfLabel, roleOf, vocabulary, type Entity, type Book, type Relationship } from "@writer/core";
import { useGitHubRepo } from "../github/repo.ts";
import { EntryIssues } from "../issues/entry-issues.tsx";
import { useIssueList } from "../issues/use-issues.ts";
import { useNotice } from "../novel/notice.tsx";
import { SceneEditor, type SpellService } from "@writer/editor/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useStore } from "zustand";
import { imageUrl } from "@writer/client";
import { api, keys } from "../api.ts";
import type { Workspace } from "../novel/workspace.ts";
import { ErrorAlert } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { Picture, PictureSlot, usePictureUrl } from "./picture.tsx";
import { pictureAlt, shapeForType } from "./pictures.ts";
import { AddButton, Lead, PencilButton, TextEditor, useInPlace } from "./profile.tsx";
import { EntryFields, NamedBy } from "./entry-fields.tsx";
import { RelationshipArcs } from "./arcs.tsx";
import { NotesAbout } from "../notes/notes-about.tsx";
import { InTheStory } from "./strip.tsx";
import { AppearsIn, usePassages } from "./appears-in.tsx";
import { QuotesFrom } from "./quotes-from.tsx";
import { TypeSections } from "./type-sections.tsx";
import { mentionEntities, typeOf } from "./types.ts";



/**
 * A bible entry as a profile (heffrey78/gh-writer#158), read first: its type, tags, name and other names, a portrait,
 * the summary as a lead, its fields as rows, then its notes, issues, scenes and relationships. Each
 * part edits in place from its pencil (or "+ Add…" while empty), saved to the entry's file at once.
 */
export function EntryPage({
  novelId,
  novel,
  entity,
  workspace,
  spell,
  embedded,
  startEditing,
  size = "page",
}: {
  novelId: string;
  novel: Book;
  entity: Entity;
  workspace: Workspace;
  spell?: { service: SpellService; onAddWord: (w: string) => void } | undefined;
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
  const file = useStore(workspace.store, (s) => s.files[entity.file]);
  const mentions = useMemo(() => mentionEntities(novel), [novel]);
  /** How a piece refers to it, in the kind's words: a field's role ("point of view", "set here"), or a mention. */
  const via = (link: string) => {
    const f = novel.kind.fields.find((x) => x.key === link);
    return f ? roleOf(f) : link === "mention" ? "mentioned" : link;
  };
  const ids = { notes: useId(), parts: useId() };
  const part = (name: string) => `${ids.parts}-${name}`;
  const passages = usePassages(novel, entity.id);
  const relationships = novel.relationships.filter((r) => r.from === entity.id || r.to === entity.id).length;
  const place = useInPlace(startEditing);
  const shape = shapeForType(entity.type);
  const picture = usePictureUrl(novelId, entity.image);

  useEffect(() => void workspace.open([entity.file]), [workspace, entity.file]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
  /** The file's current hash, after any notes still being saved. */
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
        <div className="grid min-w-0 flex-1 gap-1.5">
          {!tab && <div className={cn("flex items-center gap-2", embedded && "pr-8")}>
            <p className="flex-1 text-sm text-muted">
              <Link to={`/novels/${novelId}/bible`} className="underline-offset-2 hover:underline">
                {vocabulary(novel.kind).codex.One}
              </Link>{" "}
              · {type?.label ?? entity.type}
            </p>
            <Button variant="ghost" size="sm" onClick={() => remove.mutate(false)} disabled={remove.isPending}>
              <Trash2 className="size-4" aria-hidden /> Delete
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

      <EntryFields novelId={novelId} novel={novel} entity={entity} place={place} change={(fields) => change({ fields })} compact={tab} />
      <NamedBy novelId={novelId} novel={novel} entity={entity} compact={tab} />

      {!tab && (
        <PartsStrip
          label={`Parts of the ${vocabulary(novel.kind).entity.one}`}
          parts={[
            { id: part("profile"), label: "Profile" },
            { id: part("notes"), label: "Notes" },
            { id: part("story"), label: `In the ${vocabulary(novel.kind).subject}` },
            { id: part("passages"), label: `Appears in · ${passages.length}` },
            { id: part("relationships"), label: `Relationships · ${relationships}` },
          ]}
        />
      )}

      <section id={part("notes")} tabIndex={-1} aria-labelledby={`${ids.notes}-h`} className="grid scroll-mt-12 gap-1 border-t border-rule pt-4 outline-none">
        <h2 id={`${ids.notes}-h`} className="text-xs font-semibold tracking-wide text-muted uppercase">
          Notes
        </h2>
        {file ? (
          // Prose that edits in place, as part of the page.
          <SceneEditor
            key={entity.file}
            sceneId={entity.file}
            label={`Notes on ${entity.name}`}
            placeholder="Backstory, voice, anything worth remembering…"
            markdown={file.body}
            onChange={(md) => workspace.change(entity.file, md)}
            entities={mentions}
            pictureUrl={(path) => imageUrl(novelId, path)}
            className={cn("ghw-notes", tab && "[--ghw-prose-size:1rem]")}
            {...(spell ? { spell } : {})}
          />
        ) : (
          <p className="text-sm text-muted">Opening…</p>
        )}
        <QuotesFrom novelId={novelId} novel={novel} body={file?.body ?? entity.body} />
      </section>

      {!tab && <EntryIssues novelId={novelId} novel={novel} entity={entity} />}

      <InTheStory novelId={novelId} novel={novel} entity={entity} compact={tab} id={part("story")} />
      <AppearsIn novelId={novelId} novel={novel} entity={entity} workspace={workspace} passages={passages} compact={tab} id={part("passages")} />
      <NotesAbout novelId={novelId} novel={novel} id={entity.id} />
      {!tab && <TypeSections novelId={novelId} novel={novel} entity={entity} workspace={workspace} />}

      <RelationshipArcs novelId={novelId} novel={novel} entity={entity} compact={tab} id={part("relationships")} />
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
 * part and takes the focus there, and the one being read is marked.
 */
function PartsStrip({ label, parts }: { label: string; parts: { id: string; label: string }[] }) {
  const [reading, setReading] = useState(parts[0]?.id);
  const key = parts.map((p) => p.id).join(" ");
  useEffect(() => {
    const showing = new Map<string, boolean>();
    // A part is being read while it crosses the top half of the screen, under the strip.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) showing.set(e.target.id, e.isIntersecting);
        const first = parts.find((p) => showing.get(p.id));
        if (first) setReading(first.id);
      },
      { rootMargin: "-48px 0px -50% 0px" },
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
    el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
    setReading(id);
  };
  return (
    <nav aria-label={label} className="sticky top-0 z-10 -my-2 flex gap-1 overflow-x-auto border-b border-rule bg-paper py-1.5">
      {parts.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-current={reading === p.id ? "true" : undefined}
          onClick={() => go(p.id)}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1 text-xs whitespace-nowrap focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
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
