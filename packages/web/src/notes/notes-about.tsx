import { notesMentioning, type Book, type Note } from "@writer/core";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { ProfileSection } from "../bible/profile.tsx";

/**
 * The writer's notes that mention an entry or an event (heffrey78/gh-writer#205), on its profile: each opens its page.
 * Nothing when no note mentions it. `notes` when the profile has them already; `children` under the list.
 */
export function NotesAbout({ novelId, novel, id, notes: given, sectionId, children }: { novelId: string; novel: Book; id: string; notes?: Note[]; sectionId?: string; children?: ReactNode }) {
  const notes = useMemo(() => given ?? notesMentioning(novel, id), [given, novel, id]);
  if (!notes.length) return null;
  return (
    <ProfileSection title="In your notes" {...(sectionId ? { id: sectionId } : {})}>
      <ul className="grid gap-1 text-sm">
        {notes.map((n) => (
          <li key={n.id}>
            <Link
              to={`/novels/${novelId}/note/${n.id}`}
              className="text-accent underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent"
            >
              {n.title}
            </Link>
            {n.tags.length > 0 && <span className="text-muted"> · {n.tags.join(", ")}</span>}
          </li>
        ))}
      </ul>
      {children}
    </ProfileSection>
  );
}
