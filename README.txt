Shang Shi — Weighted Tip Allocator

Implements your Excel formulas:
- E = IF(D="Yes", C/4, 0)              → weight for present non‑kitchen
- SUMIFS(E:D="Yes") → total weight     → equivalent to your $Y$1 / $X$1
- Staff share = 0.75 * Pool * (E / SUM(E where D="Yes"))
- Kitchen share = 0.25 * Pool if Kitchen Attendance = "Yes"
- Final = share * Pool (same result once combined above)

CSV columns (case‑insensitive): Date, Name, Role, Attendance, Pool, Value
- “Value” matches your Column C used in the E formula.

Usage
1) Open index.html → Upload your CSV (or deploy the folder to GitHub Pages/Netlify/Vercel).
2) See Daily Allocation and Totals by Person. Missing Pool or Value fields are flagged.

Notes
- If no non‑kitchen staff are present on a day, the 75% staff portion is marked Unallocated for that day.
- Kitchen’s allocation only triggers when Kitchen attendance is “Yes”.

Security
- 100% static, client‑side. CSV stays in the browser.
