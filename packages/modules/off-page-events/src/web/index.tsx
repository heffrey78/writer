import { vocabulary } from "@writer/core";
import { useNewRecord, type WebModule } from "@writer/web/modules.tsx";
import { asEvent, EVENT, eventsOf } from "../core/index.ts";
import { EventCard } from "./card.tsx";
import { events } from "./client.ts";
import { EventPage } from "./event-page.tsx";
import { FORMAT_MOVE, needsFormatMove } from "./format-move.tsx";
import { EventCards } from "./gallery.tsx";

/**
 * Off-page events' web half (#33): an event's page over the codex's gallery and in the Entry tab, the
 * events' section of the gallery, an event in a mention card, a new one from its title or from a
 * note, and the palette's ways to them.
 */
export const offPageEventsWeb: WebModule = {
  id: "off-page-events",
  records: [
    {
      type: EVENT.key,
      page: ({ novelId, novel, workspace, record, spell, embedded, size }) => (
        <EventPage novelId={novelId} novel={novel} event={asEvent(record)} workspace={workspace} spell={spell} {...(embedded ? { embedded } : {})} {...(size ? { size } : {})} />
      ),
      gallery: (view) => <EventCards {...view} />,
      card: ({ novel, record, open }) => <EventCard novel={novel} record={record} open={open} />,
      create: {
        placeholder: "The flood of '09",
        // Made in a novel in format v1, it moves the novel to v2 (D11).
        hint: ({ novel }) => needsFormatMove(novel) && <p className="text-sm text-muted">{FORMAT_MOVE}</p>,
        make: async ({ novelId, novel }, title) => (await events.create(novelId, { title }, { migrate: needsFormatMove(novel) })).id,
      },
      fromNote: {
        label: "An off-page event, the note as its note",
        action: "Make the event",
        hint: ({ novel }) => needsFormatMove(novel) && <p className="text-muted">{FORMAT_MOVE}</p>,
        make: async ({ novelId, novel }, note, keep) => (await events.fromNote(novelId, note.id, { keep, migrate: needsFormatMove(novel) })).id,
      },
    },
  ],
  commands: ({ novelId, novel, navigate }) => [
    { id: "novel.newEvent", title: "New off-page event", group: vocabulary(novel.kind).codex.One, keywords: ["event", "backstory", "timeline"], run: () => useNewRecord.getState().ask(EVENT.key) },
    ...eventsOf(novel).map((e) => ({ id: `novel.event.${e.id}`, title: `Off the page: ${e.title}`, group: "Go to", keywords: ["event"], run: () => navigate(`/novels/${novelId}/event/${e.id}`) })),
  ],
};
