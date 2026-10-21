import { countWords, vocabulary, type Book } from "@writer/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@writer/web/ui/button.tsx";
import { cn } from "@writer/web/ui/cn.ts";
import { PAGE } from "@writer/web/ui/page.ts";
import { useViewParams } from "@writer/web/ui/view-params.ts";
import { entriesIn, today, type Day } from "../core/index.ts";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const number = new Intl.NumberFormat();

/** "2026-10" moved by `by` months. */
function shift(month: string, by: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

/**
 * The calendar (#38): a month of days, Monday first, each with its entries and their words, today
 * marked and, without one, a way to write it. Earlier and later months by their buttons; the month
 * shown is in the address (?month=2026-10).
 */
export function CalendarPage({ novelId, novel }: { novelId: string; novel: Book }) {
  const [params, setParams] = useViewParams();
  const now = today();
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : now.slice(0, 7);
  const w = vocabulary(novel.kind);
  const entries = entriesIn(novel, month);
  const first = new Date(`${month}-01T00:00:00Z`);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  // Monday first: the blank days before the 1st.
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (Day | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const name = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const written = [...entries.values()].flat();
  const go = (to: string) => setParams({ month: to === now.slice(0, 7) ? undefined : to });

  return (
    <div className={cn(PAGE, "grid content-start gap-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => go(shift(month, -1))} aria-label="Earlier month">
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="min-w-36 text-center font-medium">{name}</span>
          <Button size="sm" variant="ghost" onClick={() => go(shift(month, 1))} aria-label="Later month">
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          {month !== now.slice(0, 7) && (
            <Button size="sm" onClick={() => go(now.slice(0, 7))}>
              This month
            </Button>
          )}
        </div>
      </div>
      <p role="status" className="text-sm text-muted">
        {written.length ? `${w.piece.count(written.length)}, ${number.format(written.reduce((n, p) => n + countWords(p.body), 0))} words` : `No ${w.piece.many} this month.`}
      </p>
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{`${w.piece.Many} in ${name}`}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" className="pb-1 text-left text-xs font-medium text-muted">
                <abbr title={d} className="no-underline">
                  {d.slice(0, 3)}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((day, j) =>
                day ? (
                  <td key={day} className={cn("h-20 border border-rule p-1.5 align-top", day === now && "bg-accent-soft")}>
                    <span className={cn("text-xs", day === now ? "font-semibold" : "text-muted")}>
                      {Number(day.slice(8))}
                      {day === now && <span className="sr-only"> (today)</span>}
                    </span>
                    <ul className="grid gap-0.5">
                      {(entries.get(day) ?? []).map((p) => (
                        <li key={p.id} className="truncate">
                          <Link to={`/novels/${novelId}/scene/${p.id}`} className="text-accent underline-offset-2 hover:underline" title={p.title}>
                            {p.title}
                          </Link>{" "}
                          <span className="text-xs text-muted">{number.format(countWords(p.body))}</span>
                        </li>
                      ))}
                    </ul>
                    {day === now && !entries.has(day) && (
                      <Link to={`/novels/${novelId}/today`} className="text-xs text-accent underline-offset-2 hover:underline">
                        Write today's {w.piece.one}
                      </Link>
                    )}
                  </td>
                ) : (
                  <td key={`blank-${i}-${j}`} className="h-20 border border-rule bg-paper" aria-hidden />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
