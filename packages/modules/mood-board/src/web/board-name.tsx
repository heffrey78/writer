import { ErrorAlert } from "@writer/web/ui/alert.tsx";
import { Button } from "@writer/web/ui/button.tsx";
import { Modal } from "@writer/web/ui/dialog.tsx";
import { Field } from "@writer/web/ui/field.tsx";
import { useState } from "react";

/** Naming a board, new or renamed: its title, then `onName`, which the dialog waits for. */
export function BoardNameDialog({ title, action, initial = "", onName, onClose }: { title: string; action: string; initial?: string; onName: (title: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Modal title={title} onClose={onClose} className="w-[min(26rem,calc(100vw-2rem))]">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          onName(name.trim()).then(onClose, (err: unknown) => {
            setBusy(false);
            setError(err instanceof Error ? err.message : String(err));
          });
        }}
      >
        <Field label="Title" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Belfry" data-autofocus required />
        {error && <ErrorAlert title="The board couldn't be saved" detail={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
            {action}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
