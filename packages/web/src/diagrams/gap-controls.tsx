import type { ReactNode } from "react";
import type { GapThreshold } from "@writer/core/diagrams";
import { useWords } from "../novel/kind.ts";
import { writeGap } from "./gap-param.ts";

/** How long an absence must last to count: a number, in pieces (scenes) or words. `extra` goes beside them. */
export function GapControls({ legend, threshold, onChange, extra }: { legend: string; threshold: GapThreshold; onChange: (gap: string) => void; extra?: ReactNode }) {
  const w = useWords();
  return (
    <fieldset className="flex items-end gap-2">
      <legend className="mb-1 font-medium">{legend}</legend>
      <input
        type="number"
        min={0}
        aria-label="How many"
        value={"scenes" in threshold ? threshold.scenes : threshold.words}
        onChange={(e) => {
          const n = Math.max(0, Math.round(Number(e.target.value) || 0));
          onChange(writeGap("scenes" in threshold ? { scenes: n } : { words: n }));
        }}
        className="h-8 w-24 rounded-md border border-rule bg-raised px-2"
      />
      <select
        aria-label="Counted in"
        value={"scenes" in threshold ? "scenes" : "words"}
        onChange={(e) => onChange(writeGap(e.target.value === "words" ? { words: 5000 } : { scenes: 3 }))}
        className="h-8 rounded-md border border-rule bg-raised px-2"
      >
        <option value="scenes">{w.piece.many}</option>
        <option value="words">words</option>
      </select>
      {extra}
    </fieldset>
  );
}
