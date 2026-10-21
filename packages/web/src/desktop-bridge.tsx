import { useQuery } from "@tanstack/react-query";
import { FolderOpen } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAbout } from "./about.tsx";
import { api, keys } from "./api.ts";
import { allCommands, useCommandRegistry } from "./commands.ts";
import { chooseFolder, desktop, onShellCommand, reportRecent } from "./desktop.ts";
import { Button } from "./ui/button.tsx";

/** In the desktop app: runs the shell's commands in this page, and keeps its Open Recent menu current. */
export function DesktopBridge() {
  const navigate = useNavigate();
  const library = useQuery({ queryKey: keys.library, queryFn: api.library, enabled: desktop });
  useEffect(() => onShellCommand("go", (path) => path && void navigate(path)), [navigate]);
  useEffect(() => onShellCommand("about", () => useAbout.getState().set(true)), []);
  // A menu item that's a palette command (Today's Entry: daily.today), run where it's offered: at once,
  // or once the page offers it (a shelf still loading its books), for a few seconds.
  useEffect(() => onShellCommand("command", (id) => id && runWhenOffered(id)), []);
  useEffect(() => {
    if (library.data) reportRecent(library.data.novels.slice(0, 10).map(({ id, title }) => ({ id, title })));
  }, [library.data]);
  return null;
}

/** Beside a folder field in the desktop app: choose the folder in the system's dialog instead of typing it. */
export function ChooseFolder({ title, onChosen }: { title: string; onChosen: (path: string) => void }) {
  if (!desktop) return null;
  return (
    <Button className="justify-self-start" onClick={() => void chooseFolder(title).then((path) => path && onChosen(path))}>
      <FolderOpen className="size-4" aria-hidden /> Choose…
    </Button>
  );
}

/** Run the palette command `id` now if it's offered, else when it is, giving up after `ms`. */
function runWhenOffered(id: string, ms = 5_000): void {
  const find = () => allCommands(useCommandRegistry.getState().owners).find((c) => c.id === id);
  const now = find();
  if (now) return now.run();
  const stop = useCommandRegistry.subscribe(() => {
    const c = find();
    if (!c) return;
    done();
    c.run();
  });
  const timer = setTimeout(() => done(), ms);
  const done = () => {
    stop();
    clearTimeout(timer);
  };
}
