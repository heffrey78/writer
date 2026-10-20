import { proseText, type Book, type ModuleRecord } from "@writer/core";
import { FieldRows, Lead } from "@writer/web/bible/profile.tsx";
import { whenOf } from "@writer/web/novel/scene-details.tsx";
import { Button } from "@writer/web/ui/button.tsx";
import { asEvent } from "../core/index.ts";

/** An off-page event in a mention card (heffrey78/gh-writer#165): when, who and where, and its note; Open event opens it in the Entry tab. */
export function EventCard({ novel, record, open }: { novel: Book; record: ModuleRecord; open: () => void }) {
  const event = asEvent(record);
  const time = whenOf({ when: event.when, duration: event.duration });
  const names = (ids: string[]) => ids.map((id) => novel.entities.find((e) => e.id === id)?.name ?? id).join(", ");
  return (
    <>
      {time.when && <Lead size="card">{[time.when, time.duration].filter(Boolean).join(" · ")}</Lead>}
      <FieldRows
        compact
        fields={(
          [
            ["who", event.characters],
            ["where", event.locations],
          ] as const
        ).flatMap(([label, ids]) => (ids.length ? [[label, names(ids)] as [string, string]] : []))}
      />
      {proseText(event.body).trim() && <p className="line-clamp-3 text-muted">{proseText(event.body).trim()}</p>}
      <div>
        <Button size="sm" onClick={open}>
          Open event
        </Button>
      </div>
    </>
  );
}
