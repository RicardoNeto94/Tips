// Weighted distribution with robust CSV parsing & debug panel
(() => {
  const $ = sel => document.querySelector(sel);
  const alerts = $("#alerts");
  const stats = $("#stats");
  const dailyHead = $("#thead-daily"), dailyBody = $("#tbody-daily");
  const totalHead = $("#thead-total"), totalBody = $("#tbody-total");
  const chartCanvas = $("#chart");
  const debug = $("#debug"), debugOut = $("#debugOut");

  // Config: map to your CSV column names (case-insensitive match applied later)
  const CONFIG = {
    date: 'Date',
    name: 'Name',
    role: 'Role',
    attendance: 'Attendance',
    pool: 'Pool',
    value: 'Value', // corresponds to Excel column C used in E = IF(D="Yes", C/4, 0)
    kitchenMatcher: /kitchen/i, // matches Role or Name to identify kitchen
    yes: /^yes$/i,
  };

  $("#toggleDebug").addEventListener('click', () => {
    debug.classList.toggle('hidden');
  });

  document.getElementById('dlSample').addEventListener('click', () => {
    const sample = [
      ['Date','Name','Role','Attendance','Pool','Value'],
      ['05/08','Kitchen','Kitchen','Yes','1000',''], // Kitchen row (Value unused)
      ['05/08','Juan','FOH','Yes','', '12'],         // Value -> weight = 12/4 = 3
      ['05/08','Alina','FOH','Yes','', '8'],         // weight = 2
      ['05/08','Ryu','FOH','No','', '10'],           // not counted (No)
      ['06/08','Kitchen','Kitchen','Yes','1200',''],
      ['06/08','Juan','FOH','No','', '10'],
      ['06/08','Alina','FOH','Yes','', '16'],        // weight = 4
      ['06/08','Ryu','FOH','Yes','', '12'],          // weight = 3
    ].map(r=>r.join(';')).join('\n'); // EU-style ; delimiter
    const blob = new Blob([sample], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sample_weighted_eu.csv';
    a.click();
  });

  $("#file").addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const info = { size: file.size, name: file.name };
    try {
      const parsed = parseDelimited(text);
      const rows = toObjects(parsed.rows, parsed.headers);
      const normalized = normalizeKeys(rows);
      const mandatory = [CONFIG.date, CONFIG.name, CONFIG.role, CONFIG.attendance, CONFIG.pool, CONFIG.value];
      const missing = mandatory.filter(k => !hasKey(normalized, k));
      debugOut.textContent = JSON.stringify({
        file: info,
        detectedDelimiter: parsed.delimiter,
        header: parsed.headers,
        rowsParsed: rows.length,
        keysFoundSample: Object.keys(normalized[0] || {})
      }, null, 2);

      if (!rows.length) {
        addAlert('No rows parsed from CSV. Check delimiter (comma/semicolon/tab) and headers.');
        return;
      }
      if (missing.length) {
        addAlert('Missing required columns: ' + missing.join(', ') + '. Check header names or adjust CONFIG.');
      }

      const groups = groupBy(normalized, r => r[CONFIG.date]);
      const perDayRows = [];
      const totalsByName = new Map();
      let totalPoolAll = 0, allocatedAll = 0, unallocatedAll = 0;

      for (const [date, items] of groups) {
        const pool = firstNonEmpty(items.map(r => r[CONFIG.pool]));
        const poolNum = num(pool);
        totalPoolAll += poolNum;

        const kitchenYes = items.some(r => isKitchen(r) && isYes(r[CONFIG.attendance]));
        const kitchenAmount = kitchenYes ? 0.25 * poolNum : 0;
        const staffAvailable = poolNum - kitchenAmount;

        // Non‑kitchen present weights: weight = Value / 4 if Attendance=Yes
        const presentStaff = items.filter(r => !isKitchen(r) && isYes(r[CONFIG.attendance]));
        const weights = presentStaff.map(r => ({ r, w: num(r[CONFIG.value]) / 4 }));
        const totalWeight = sum(weights.map(w => w.w));
        const unallocated = totalWeight > 0 ? 0 : Math.max(0, staffAvailable);
        unallocatedAll += unallocated;

        const staff75 = 0.75 * poolNum;

        for (const r of items) {
          const base = {
            Date: date,
            Name: r[CONFIG.name],
            Role: r[CONFIG.role],
            Attendance: r[CONFIG.attendance],
            Pool: poolNum ? poolNum.toFixed(2) : '',
            Kitchen25: kitchenAmount.toFixed(2),
            Staff75: staff75.toFixed(2),
            Weight: '',
            Allocation: '0.00',
          };

          if (isKitchen(r)) {
            base.Weight = '';
            base.Allocation = kitchenAmount.toFixed(2);
          } else if (isYes(r[CONFIG.attendance])) {
            const w = num(r[CONFIG.value]) / 4;
            base.Weight = w.toFixed(2);
            const share = totalWeight > 0 ? (w / totalWeight) * staffAvailable : 0;
            base.Allocation = share.toFixed(2);
          }
          perDayRows.push(base);

          const key = r[CONFIG.name] || '(Unnamed)';
          const prev = totalsByName.get(key) || { Name:key, Role:r[CONFIG.role], Days:0, Total:0 };
          if (isKitchen(r)) {
            if (kitchenYes) { prev.Days += 1; prev.Total += kitchenAmount; }
          } else if (isYes(r[CONFIG.attendance])) {
            prev.Days += 1;
            prev.Total += num(base.Allocation);
          }
          totalsByName.set(key, prev);
        }
        const allocatedThisDay = kitchenAmount + (totalWeight > 0 ? staffAvailable : 0);
        allocatedAll += allocatedThisDay;
      }

      // Stats
      const cards = [
        {k:'Total Pool', v: euro(totalPoolAll)},
        {k:'Allocated', v: euro(allocatedAll)},
        {k:'Unallocated', v: euro(unallocatedAll)},
        {k:'Rule', v: 'Kitchen 25% if Yes; Staff 75% weighted by Value/4'},
      ];
      stats.innerHTML = cards.map(c => `<div class="stat"><div class="k">${esc(c.k)}</div><div class="v">${esc(c.v)}</div></div>`).join('');

      // Alerts: missing Pool, missing Value for present staff
      const missingPools = Array.from(groups.entries()).filter(([d, items]) => num(firstNonEmpty(items.map(r => r[CONFIG.pool]))) === 0);
      for (const [d] of missingPools) addAlert(`No Pool value for date ${esc(d)} — set it in any row for that date.`);
      const missingValues = normalized.filter(r => !isKitchen(r) && isYes(r[CONFIG.attendance]) && (r[CONFIG.value]===undefined || String(r[CONFIG.value]).trim()===''));
      if (missingValues.length) addAlert(`Some present staff have empty Value (used for weights). They will get 0 allocation.`);

      // Tables
      renderTable(dailyHead, dailyBody, perDayRows, ['Date','Name','Role','Attendance','Pool','Kitchen25','Staff75','Weight','Allocation'], ['Pool','Kitchen25','Staff75','Weight','Allocation']);
      const totals = Array.from(totalsByName.values()).sort((a,b)=>b.Total-a.Total);
      renderTable(totalHead, totalBody, totals, ['Name','Role','Days','Total'], ['Total']);

      // Chart
      renderChart(chartCanvas, totals.map(t=>t.Name), totals.map(t=>t.Total));
    } catch (err) {
      addAlert('Error parsing CSV: ' + err.message);
      debugOut.textContent = (debugOut.textContent || '') + "\\n" + err.stack;
    }
  });

  // ===== CSV Parsing (delimiter auto-detect: , ; \\t | ) =====
  function parseDelimited(text){
    // strip BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const firstLine = text.split(/\r?\n/)[0] || '';
    const candidates = [',',';','\t','|'];
    const counts = candidates.map(d => (firstLine.match(new RegExp(escapeReg(d), 'g')) || []).length);
    const delimiter = candidates[counts.indexOf(Math.max(...counts))] || ',';
    const rows = parseWithDelimiter(text, delimiter);
    return { delimiter, headers: rows[0] || [], rows };
  }
  function escapeReg(d){ return d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function parseWithDelimiter(text, delim){
    const out=[]; let i=0,cur='',row=[],inQ=false;
    while(i<text.length){
      const c=text[i];
      if(inQ){
        if(c=='"'){ if(text[i+1]=='"'){cur+='"';i++;} else inQ=false; }
        else cur+=c;
      } else {
        if(c=='"') inQ=true;
        else if(c===delim){ row.push(cur); cur=''; }
        else if(c=='\n'){ row.push(cur); pushRow(row,out); row=[]; cur=''; }
        else if(c=='\r'){ /* ignore */ }
        else cur+=c;
      }
      i++;
    }
    if(cur.length || row.length){ row.push(cur); pushRow(row,out); }
    return out;
  }
  function pushRow(row,out){
    // trim cells & normalize NBSP/whitespace
    out.push(row.map(c => String(c).replace(/\u00A0/g,' ').trim()));
  }
  function toObjects(rows, header){
    if (!rows.length) return [];
    const hdr = rows[0];
    const body = rows.slice(1).filter(r => r.length && r.some(v => String(v).trim().length));
    return body.map(r => {
      const o={};
      hdr.forEach((h,i)=>o[h]=r[i]??'');
      return o;
    });
  }

  // ===== Normalization & helpers =====
  function normalizeKeys(rows){
    return rows.map(r => {
      const out={};
      for (const [k,v] of Object.entries(r)){
        const lk = k.toLowerCase().replace(/\s+/g,'').trim();
        if (lk==='date') out[CONFIG.date]=v;
        else if (lk==='name' || lk==='employee') out[CONFIG.name]=v;
        else if (lk==='role' || lk==='position') out[CONFIG.role]=v;
        else if (lk==='attendance' || lk==='present') out[CONFIG.attendance]=v;
        else if (lk==='pool' || lk==='totalpool' || lk==='tips' || lk==='total') out[CONFIG.pool]=v;
        else if (lk==='value' || lk==='points' || lk==='c') out[CONFIG.value]=v;
        else out[k]=v;
      }
      return out;
    });
  }
  function hasKey(arr, key){ return arr.some(r => Object.prototype.hasOwnProperty.call(r, key)); }
  function groupBy(arr, keyFn) { const m = new Map(); for (const it of arr){ const k=keyFn(it); if(!m.has(k)) m.set(k, []); m.get(k).push(it); } return m; }
  function firstNonEmpty(arr){ for(const v of arr){ if (v!==undefined && v!==null && String(v).trim()!=='') return v; } return ''; }
  function isKitchen(row){ const val = (row[CONFIG.role] || row[CONFIG.name] || '').toString(); return CONFIG.kitchenMatcher.test(val); }
  function isYes(v){ return CONFIG.yes.test(String(v||'')); }
  function num(v){ if (v===null||v===undefined||v==='') return 0; const s=String(v).replace(/\s+/g,'').replace(',','.'); const n=Number(s); return isFinite(n)?n:0; }
  function sum(a){ return a.reduce((x,y)=>x+num(y),0); }
  function euro(n){ return formatNum(n) + ' €'; }
  function isNumberLike(v){ return typeof v==='number' || (/^-?\d+(\.\d+)?$/.test(String(v))); }
  function formatNum(v){ const n=typeof v==='number'?v:Number(v); return n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function esc(s){ return String(s).replace(/[&<>\"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',\"'\":'&#39;'}[c])); }
  function renderTable(headEl, bodyEl, rows, cols, rightCols=[]) {
    headEl.innerHTML = '<tr>' + cols.map(c=>`<th>${esc(c)}</th>`).join('') + '</tr>';
    bodyEl.innerHTML = rows.map(r => '<tr>' + cols.map(c => {
      const v = r[c] ?? '';
      const cls = rightCols.includes(c) ? ' class="right"' : '';
      return `<td${cls}>${esc(isNumberLike(v) ? formatNum(v) : v)}</td>`;
    }).join('') + '</tr>').join('');
  }
  function renderChart(canvas, labels, values){
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const W=canvas.width,H=canvas.height,pad=36, innerW=W-pad*2, innerH=H-pad*2;
    const maxV = Math.max(1, ...values);
    const barW = innerW / Math.max(1, values.length);
    // axes
    ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, H-pad); ctx.lineTo(W-pad, H-pad); ctx.strokeStyle='#9a9aa0'; ctx.stroke();
    ctx.globalAlpha = 1;
    // bars
    for (let i=0;i<values.length;i++){
      const v = values[i];
      const h = innerH * (v/maxV);
      const xPos = pad + i*barW + 4;
      const yPos = H - pad - h;
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(xPos, yPos, Math.max(6, barW-8), h);
      if (barW > 60) {
        ctx.fillStyle = '#9a9aa0';
        ctx.font = '12px system-ui';
        ctx.fillText(String(labels[i]).slice(0,14), xPos, H - pad + 14);
      }
    }
  }
})();