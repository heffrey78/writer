# The runs in results/runs.jsonl as a table, one row per engine, threads and passage.
import json, sys
rows = [json.loads(l) for l in open("results/runs.jsonl")]
print(f"{'engine':26}{'thr':>3} {'clip':6}{'WER':>6}{'RTF':>7}{'cores':>6}{'RAM':>6}{'model':>6}{'heard50':>8}{'heard90':>8}{'settle50':>9}{'settle90':>9}{'miss':>5}{'prose':>8}")
for r in rows:
    fh = r["first_heard_ms"] or {}; st = r["settle_ms"] or {}
    print(f"{r['engine']:26}{r['threads']:>3} {r['clip'].split('-')[-1]:6}{r['wer']:6.2f}{r['rtf']:7.3f}{r['cores']:6.2f}{r['peak_mb']:6.0f}{r['model_mb']:6.0f}{fh.get('p50',0):8.0f}{fh.get('p90',0):8.0f}{st.get('p50',0):9.0f}{st.get('p90',0):9.0f}{r['unsettled']:5}{r['prose_phrases']:5}/{r['phrases']:<3}")
