import { vocabulary, type Book } from "@writer/core";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { api, keys } from "../api.ts";
import type { moduleRecordTypes } from "../modules.tsx";
import { NotePage } from "../notes/note-page.tsx";
import { ItemModal, NewItem, useCloseTo, type OverState } from "../ui/item-modal.tsx";
import type { useSpell } from "./spell.ts";
import type { Workspace } from "./workspace.ts";

/*
 * The modals over the galleries (heffrey78/gh-writer#233): /note/<id> over Notes; /note/new, /bible/new (?type=)
 * and a module's /event/new make one, starting from its title. An entry or a record, once made, opens
 * beside the index's list (#134).
 */

type Props = { novelId: string; novel: Book; workspace: Workspace; spell: ReturnType<typeof useSpell> };

/** Once made, the item in the same modal, the address naming it (in place of …/new). */
function useMade(novelId: string, kind: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const state = useLocation().state as OverState;
  return async (id: string) => {
    await queryClient.invalidateQueries({ queryKey: keys.novel(novelId) });
    void navigate(`/novels/${novelId}/${kind}/${id}`, { replace: true, state: { ...state, focusProse: true } });
  };
}

function Gone({ what }: { what: string }) {
  return (
    <div className="grid gap-2">
      <h2 className="text-xl font-semibold">No such {what}</h2>
      <p className="text-muted">It may have been deleted.</p>
    </div>
  );
}

/** A note over the Notes gallery (heffrey78/gh-writer#235). */
export function NoteOver({ novelId, novel, workspace, spell }: Props) {
  const { noteId } = useParams();
  const close = useCloseTo(`/novels/${novelId}/notes`);
  const made = useMade(novelId, "note");
  const headingId = useId();
  const note = novel.notes.find((n) => n.id === noteId);
  return (
    <ItemModal title={noteId === "new" ? "New note" : (note?.title ?? "Note")} onClose={close}>
      {noteId === "new" ? (
        <NewItem heading="New note" label="Title" placeholder="What if…" make={async (title) => made((await api.notes.create(novelId, { title })).id)} />
      ) : note ? (
        <NotePage key={note.id} novelId={novelId} novel={novel} note={note} workspace={workspace} spell={spell} embedded={{ headingId, modal: true }} />
      ) : (
        <Gone what="note" />
      )}
    </ItemModal>
  );
}

/** A new module's record (an off-page event) over the Story bible, made from its title (heffrey78/gh-writer#236); then it opens beside the list. */
export function RecordOver({ type, novelId, novel, workspace }: Props & { type: ReturnType<typeof moduleRecordTypes>[number] }) {
  const close = useCloseTo(`/novels/${novelId}/bible#${slug(type.def.group)}`);
  const made = useMade(novelId, type.type);
  const view = { novelId, novel, workspace };
  const what = `New ${type.def.noun.label.toLowerCase()}`;
  return (
    <ItemModal title={what} onClose={close}>
      <NewItem heading={what} label="Title" placeholder={type.create.placeholder} make={async (title) => made(await type.create.make(view, title))}>
        {type.create.hint?.(view)}
      </NewItem>
    </ItemModal>
  );
}

/** A group's anchor in the gallery: "off-the-page". */
export const slug = (group: string) => group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A new story bible entry over the index, by its type (unless the address names it) and name (heffrey78/gh-writer#237); then it opens beside the list. */
export function EntryOver({ novelId, novel }: Props) {
  const [params] = useSearchParams();
  const close = useCloseTo(`/novels/${novelId}/bible`);
  const made = useMade(novelId, "bible");
  const typeId = useId();
  const asked = params.get("type") ?? undefined;
  const [chosen, setChosen] = useState(novel.entityTypes.some((t) => t.key === asked) ? asked! : (novel.entityTypes[0]?.key ?? "character"));
  const w = vocabulary(novel.kind);
  const label = (novel.entityTypes.find((t) => t.key === chosen)?.label ?? w.entity.one).toLowerCase();
  return (
    <ItemModal title={`New ${label}`} onClose={close}>
      <NewItem heading={`New ${label}`} label="Name" make={async (name) => made((await api.bible.createEntity(novelId, chosen, { name })).id)}>
        {!asked && (
          <label htmlFor={typeId} className="flex items-center gap-2 text-sm text-muted">
            Type
            <select id={typeId} value={chosen} onChange={(e) => setChosen(e.target.value)} className="h-8 rounded-md border border-rule bg-raised px-2 text-ink">
              {novel.entityTypes.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </NewItem>
    </ItemModal>
  );
}
