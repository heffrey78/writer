import type { Book } from "@writer/core";
import { useEffect, useRef } from "react";
import { moduleOutlineOrders } from "../modules.tsx";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { cn } from "../ui/cn.ts";
import { OutlineBoard } from "./board.tsx";
import { OutlineCards } from "./corkboard.tsx";
import { OutlineTable } from "./outline.tsx";
import type { Workspace } from "./workspace.ts";
import { PAGE } from "../ui/page.ts";

/*
 * The outline (heffrey78/gh-writer#136): every scene in reading order, as a table, as cards (the corkboard), or on the
 * drafting board by status (heffrey78/gh-writer#11), switched in place. The choice is in the address (/outline/table,
 * /outline/cards, /outline/board) and remembered for /outline.
 */

const VIEWS = [
  { key: "table", label: "Table" },
  { key: "cards", label: "Cards" },
  { key: "board", label: "Board" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const KEY = "ghw.outlineView";

const isView = (v: string | null | undefined): v is View => VIEWS.some((x) => x.key === v);

/**
 * The table and the cards in reading order, or in an order a module adds (story time, with the
 * off-page events among the scenes, heffrey78/gh-writer#165): ?order=<key>, remembered.
 */
const READING = "reading";
const ORDER_KEY = "ghw.outlineOrder";

function rememberedOrder(): string {
  try {
    return localStorage.getItem(ORDER_KEY) ?? READING;
  } catch {
    return READING;
  }
}

function remembered(): View {
  try {
    const saved = localStorage.getItem(KEY);
    return isView(saved) ? saved : "table";
  } catch {
    return "table";
  }
}

function remember(view: View) {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // Not remembered where storage is blocked.
  }
}

export function OutlinePage({ novelId, novel, workspace }: { novelId: string; novel: Book; workspace: Workspace }) {
  const { view } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation() as { state: { focusSwitch?: boolean } | null };
  const group = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const orders = moduleOutlineOrders(novel.kind);
  const ORDERS = [{ key: READING, label: "Reading order" }, ...orders];
  const moduleOrder = orders.find((o) => o.key === params.get("order"));
  const order = moduleOrder?.key ?? READING;
  const chooseOrder = (next: string) => {
    try {
      localStorage.setItem(ORDER_KEY, next);
    } catch {
      // Not remembered where storage is blocked.
    }
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        if (next !== READING) out.set("order", next);
        else out.delete("order");
        return out;
      },
      { replace: true },
    );
  };
  // The switch keeps the focus: the view may have been drawn afresh for its address.
  useEffect(() => {
    if (state?.focusSwitch) group.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
  }, [state, view]);
  const remembers = orders.find((o) => o.key === rememberedOrder());
  if (!isView(view)) return <Navigate to={`/novels/${novelId}/outline/${remembered()}${remembered() !== "board" && remembers ? `?order=${remembers.key}` : ""}`} replace />;
  const choose = (next: View) => {
    remember(next);
    void navigate(`/novels/${novelId}/outline/${next}${moduleOrder && next !== "board" ? `?order=${moduleOrder.key}` : ""}`, { replace: true, state: { focusSwitch: true } });
  };
  const bookView = { novelId, novel, workspace };
  return (
    <div className={cn(PAGE, "grid gap-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Outline</h1>
        <div className="flex flex-wrap items-center gap-3">
          {view !== "board" && orders.length > 0 && (
            <div role="radiogroup" aria-label="Order" className="inline-flex rounded-md border border-rule bg-raised p-0.5 text-sm">
              {ORDERS.map((o) => (
                <label key={o.key} className={cn("cursor-pointer rounded px-3 py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent", order === o.key ? "bg-accent-soft font-medium" : "text-muted hover:text-ink")}>
                  <input type="radio" name="outline-order" value={o.key} checked={order === o.key} onChange={() => chooseOrder(o.key)} className="sr-only" />
                  {o.label}
                </label>
              ))}
            </div>
          )}
          <div ref={group} role="radiogroup" aria-label="Show the outline as" className="inline-flex rounded-md border border-rule bg-raised p-0.5 text-sm">
            {VIEWS.map((v) => (
              <label key={v.key} className={cn("cursor-pointer rounded px-3 py-1 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent", view === v.key ? "bg-accent-soft font-medium" : "text-muted hover:text-ink")}>
                <input type="radio" name="outline-view" value={v.key} checked={view === v.key} onChange={() => choose(v.key)} className="sr-only" />
                {v.label}
              </label>
            ))}
          </div>
        </div>
      </div>
      {view === "board" ? (
        <OutlineBoard novelId={novelId} novel={novel} workspace={workspace} />
      ) : view === "cards" ? (
        moduleOrder ? moduleOrder.cards(bookView) : <OutlineCards novelId={novelId} novel={novel} workspace={workspace} />
      ) : moduleOrder ? (
        moduleOrder.table(bookView)
      ) : (
        <OutlineTable novelId={novelId} novel={novel} workspace={workspace} />
      )}
    </div>
  );
}
