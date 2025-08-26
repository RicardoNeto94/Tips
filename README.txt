Shang Shi — Tip Allocator (v3: Column Mapper)

When uploads do nothing, it’s usually headers or delimiter. v3 removes that risk:

- Drag & drop or upload CSV
- Auto-detect delimiter (comma/semicolon/tab/pipe)
- Column mapping UI: map your headers to Date, Name, Role, Attendance, Pool, Value
- Paste-mode if files misbehave
- Same weighted logic: Kitchen 25% if present; Staff 75% weighted by Value/4

How to use
1) Open index.html
2) Upload or drop your CSV
3) In “Map your columns”, choose the right fields (it tries to auto-guess)
4) Click “Apply Mapping” → results render immediately

Deploy anywhere (GitHub Pages / Netlify / Vercel). 100% client-side.
