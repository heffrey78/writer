import type { Entity } from "@writer/core";
import { ProfileSection } from "@writer/web/bible/profile.tsx";
import type { WebModule } from "@writer/web/modules.tsx";
import { bibliographyEntry, shortCitation, sourceDetails, SOURCE, SOURCE_FIELDS } from "../core/index.ts";

/**
 * Citations' web half (#59): a source's page says how the compiled book will cite it, in the notes
 * and in the bibliography, and which of its details it doesn't have yet (fields added with the
 * page's own "Add a field").
 */
export const citationsWeb: WebModule = {
  id: "citations",
  profileSections: [{ entityType: SOURCE, render: ({ entity }) => <Citation entity={entity} /> }],
};

function Citation({ entity }: { entity: Entity }) {
  const details = sourceDetails(entity);
  const missing = SOURCE_FIELDS.filter((key) => key !== "url" && !details[key]);
  return (
    <ProfileSection title="Citation">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted">In the notes</dt>
        <dd>{shortCitation(entity)}</dd>
        <dt className="text-muted">In the bibliography</dt>
        <dd>
          {bibliographyEntry(entity).map((r, i) => (r.em ? <em key={i}>{r.text}</em> : <span key={i}>{r.text}</span>))}
        </dd>
      </dl>
      {missing.length > 0 && <p className="mt-2 text-sm text-muted">{`For a fuller entry, add a field named ${list(missing)}.`}</p>}
    </ProfileSection>
  );
}

/** "author, year or place". */
const list = (words: readonly string[]) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words.at(-1)}` : words[0]!);
