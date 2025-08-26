Shang Shi — Weighted Tip Allocator (v2)

What changed
- Robust CSV parser with delimiter auto‑detect (comma, semicolon, tab, pipe)
- UTF‑8/BOM handling and whitespace normalization
- Debug panel to see detected delimiter, headers, row count, and sample keys
- Clear alerts if required columns are missing or if no rows were parsed

Logic (unchanged)
- Kitchen gets 25% of Pool if Kitchen Attendance = "Yes"
- Remaining 75% distributed among present non‑kitchen staff, weighted by Value/4
- Totals aggregated by Name

Required headers (case-insensitive): Date, Name, Role, Attendance, Pool, Value

Usage
1) Open index.html → Upload your CSV (EU Excel exports with ; are fine).
2) Use the Debug button if “nothing happens” — it will show exactly what was detected.
3) Deploy as static site (GitHub Pages / Netlify / Vercel).

Security
- Client‑side only; your data stays in the browser.
