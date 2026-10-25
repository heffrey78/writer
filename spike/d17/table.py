# results/runs.jsonl as the write-up's Markdown tables: each engine on one thread, both passages.
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else "results/runs.jsonl")]
def key(r): return (r["engine"] + (" (beam)" if r.get("hotwords") == "" else ""), r["threads"])
by = {}
for r in rows:
    by.setdefault(key(r), {})[r["clip"].split("-")[-1]] = r
print("| Engine | Threads | Wrong words, clean / other | Words show (p50 / p90) | Phrase settles (p50 / p90) | Missed | Prose | CPU (cores) | Memory | Models |")
print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
for (engine, threads), clips in by.items():
    c, o = clips.get("clean"), clips.get("other")
    if not c: continue
    def pc(r): return f"{r['wer']:.1f}%" if r else "–"
    def ms(r, k): return f"{r[k]['p50']/1000:.1f} / {r[k]['p90']/1000:.1f} s" if r and r[k] else "–"
    miss = sum(r["unsettled"] for r in (c, o) if r)
    prose = f"{sum(r['prose_phrases'] for r in (c,o) if r)}/{sum(r['phrases'] for r in (c,o) if r)}"
    print(f"| {engine} | {threads} | {pc(c)} / {pc(o)} | {ms(c,'first_heard_ms')} | {ms(c,'settle_ms')} | {miss} | {prose} | {c['cores']:.2f} | {c['peak_mb']:.0f} MB | {c['model_mb']:.0f} MB |")
