// v3: Column mapper + drag&drop + paste fallback
(() => {
  const $ = sel => document.querySelector(sel);
  const alerts = $("#alerts");
  const stats = $("#stats");
  const dailyHead = $("#thead-daily"), dailyBody = $("#tbody-daily");
  const totalHead = $("#thead-total"), totalBody = $("#tbody-total");
  const chartCanvas = $("#chart");
  const debug = $("#debug"), debugOut = $("#debugOut");
  const mapper = $("#mapper");
  const dropzone = $("#dropzone");
  const mapDate = $("#map-date"), mapName = $("#map-name"), mapRole = $("#map-role"),
        mapAtt = $("#map-att"), mapPool = $("#map-pool"), mapVal = $("#map-val");

  const CONFIG = { date: null, name: null, role: null, attendance: null, pool: null, value: null, yes: /^yes$/i, kitchenMatcher: /kitchen/i };

  $("#toggleDebug").addEventListener('click', () => debug.classList.toggle('hidden'));

  document.getElementById('dlSample').addEventListener('click', () => {
    const sample = [
      ['Date','Employee','Position','Present','Total Pool','Points'], // odd headers to test mapping
      ['05/08','Kitchen','Kitchen','Yes','1000',''],
      ['05/08','Juan','FOH','Yes','', '12'],
      ['05/08','Alina','FOH','Yes','', '8'],
      ['05/08','Ryu','FOH','No','', '10'],
      ['06/08','Kitchen','Kitchen','Yes','1200',''],
      ['06/08','Juan','FOH','No','', '10'],
      ['06/08','Alina','FOH','Yes','', '16'],
      ['06/08','Ryu','FOH','Yes','', '12'],
    ].map(r=>r.join(';')).join('\n');
    const blob = new Blob([sample], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sample_map.csv';
    a.click();
  });

  $("#file").addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    handleRawCSV(text, { name: file.name, size: file.size });
  });

  ;['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ;['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', async (e) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const text = await file.text();
    handleRawCSV(text, { name: file.name, size: file.size });
  });

  $("#parsePaste").addEventListener('click', () => {
    const txt = $("#pasteArea").value || '';
    if (!txt.trim()) { addAlert('Paste area is empty.'); return; }
    handleRawCSV(txt, { name: 'pasted.csv', size: txt.length });
  });

  $("#applyMap").addEventListener('click', () => {
    CONFIG.date = mapDate.value; CONFIG.name = mapName.value; CONFIG.role = mapRole.value;
    CONFIG.attendance = mapAtt.value; CONFIG.pool = mapPool.value; CONFIG.value = mapVal.value;
    if (!CONFIG.date || !CONFIG.name || !CONFIG.role || !CONFIG.attendance || !CONFIG.pool || !CONFIG.value){
      addAlert('Please map all required fields.');
      return;
    }
    // Re-run last parsed rows with mapping
    if (window.__lastRows) computeAndRender(window.__lastRows);
  });

  function handleRawCSV(text, info){
    try {
      const parsed = parseDelimited(text);
      const rows = toObjects(parsed.rows, parsed.headers);
      debugOut.textContent = JSON.stringify({ file: info, detectedDelimiter: parsed.delimiter, header: parsed.headers, rowsParsed: rows.length }, null, 2);
      if (!rows.length) { addAlert('No rows parsed. Try the paste option or check delimiter.'); showMapper(parsed.headers); return; }
      showMapper(Object.keys(rows[0]));
      window.__lastRows = rows;
      addAlert('Columns detected. Map them, then click "Apply Mapping".');
    } catch (err){
      addAlert('Error parsing CSV: ' + err.message);
    }
  }

  function showMapper(headers){
    mapper.classList.remove('hidden');
    [mapDate,mapName,mapRole,mapAtt,mapPool,mapVal].forEach(sel => {
      sel.innerHTML = '<option value="">— choose —</option>' + headers.map(h=>`<option value="${esc(h)}">${esc(h)}</option>`).join('');
    });
    // try auto-guess
    autoGuess(headers);
  }

  function autoGuess(headers){
    function pick(re){ return headers.find(h => re.test(h.toLowerCase().replace(/\s+/g,''))) || ''; }
    mapDate.value = pick(/^date$/) || pick(/day|dd|datum/);
    mapName.value = pick(/^name$|^employee$/);
    mapRole.value = pick(/^role$|^position$/);
    mapAtt.value = pick(/^attendance$|^present$/);
    mapPool.value = pick(/^pool$|^totalpool$|^tips$|^total$/);
    mapVal.value = pick(/^value$|^points$|^c$/);
  }

  function computeAndRender(rows){
    // Normalize into CONFIG mapping
    const normalized = rows.map(r => ({
      [CONFIG.date]: r[CONFIG.date],
      [CONFIG.name]: r[CONFIG.name],
      [CONFIG.role]: r[CONFIG.role],
      [CONFIG.attendance]: r[CONFIG.attendance],
      [CONFIG.pool]: r[CONFIG.pool],
      [CONFIG.value]: r[CONFIG.value],
    }));

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

    // Tables
    renderTable(dailyHead, dailyBody, perDayRows, ['Date','Name','Role','Attendance','Pool','Kitchen25','Staff75','Weight','Allocation'], ['Pool','Kitchen25','Staff75','Weight','Allocation']);
    const totals = Array.from(totalsByName.values()).sort((a,b)=>b.Total-a.Total);
    renderTable(totalHead, totalBody, totals, ['Name','Role','Days','Total'], ['Total']);

    // Chart
    renderChart(chartCanvas, totals.map(t=>t.Name), totals.map(t=>t.Total));
    alerts.innerHTML = ''; // clear alerts on success
  }

  // ===== CSV Parsing (delimiter auto-detect: , ; \\t | ) =====
  function parseDelimited(text){
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const firstLine = text.split(/\\r?\\n/)[0] || '';
    const candidates = [',',';','\\t','|'];
    const counts = candidates.map(d => (firstLine.match(new RegExp(escapeReg(d), 'g')) || []).length);
    const delimiter = candidates[counts.indexOf(Math.max(...counts))] || ',';
    const rows = parseWithDelimiter(text, delimiter);
    return { delimiter, headers: rows[0] || [], rows };
  }
  function escapeReg(d){ return d.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'); }
  function parseWithDelimiter(text, delim){
    const out=[]; let i=0,cur='',row=[],inQ=false;
    while(i<text.length){
      const c=text[i];
      if(inQ){
        if(c=='\"'){ if(text[i+1]=='\"'){cur+='\"';i++;} else inQ=false; }
        else cur+=c;
      } else {
        if(c=='\"') inQ=true;
        else if(c===delim){ row.push(cur); cur=''; }
        else if(c=='\\n'){ row.push(cur); pushRow(row,out); row=[]; cur=''; }
        else if(c=='\\r'){ /* ignore */ }
        else cur+=c;
      }
      i++;
    }
    if(cur.length || row.length){ row.push(cur); pushRow(row,out); }
    return out;
  }
  function pushRow(row,out){ out.push(row.map(c => String(c).replace(/\\u00A0/g,' ').trim())); }
  function toObjects(rows, header){
    if (!rows.length) return [];
    const hdr = rows[0];
    const body = rows.slice(1).filter(r => r.length && r.some(v => String(v).trim().length));
    return body.map(r => { const o={}; hdr.forEach((h,i)=>o[h]=r[i]??''); return o; });
  }

  // ===== Helpers =====
  function groupBy(arr, keyFn) { const m = new Map(); for (const it of arr){ const k=keyFn(it); if(!m.has(k)) m.set(k, []); m.get(k).push(it); } return m; }
  function firstNonEmpty(arr){ for(const v of arr){ if (v!==undefined && v!==null && String(v).trim()!=='') return v; } return ''; }
  function isKitchen(row){ const val = (row[CONFIG.role] || row[CONFIG.name] || '').toString(); return /kitchen/i.test(val); }
  function isYes(v){ return CONFIG.yes.test(String(v||'')); }
  function num(v){ if (v===null||v===undefined||v==='') return 0; const s=String(v).replace(/\\s+/g,'').replace(',','.'); const n=Number(s); return isFinite(n)?n:0; }
  function sum(a){ return a.reduce((x,y)=>x+num(y),0); }
  function euro(n){ return formatNum(n) + ' €'; }
  function isNumberLike(v){ return typeof v==='number' || (/^-?\\d+(\\.\\d+)?$/.test(String(v))); }
  function formatNum(v){ const n=typeof v==='number'?v:Number(v); return n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function esc(s){ return String(s).replace(/[&<>\"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c])); }
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
    ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, H-pad); ctx.lineTo(W-pad, H-pad); ctx.strokeStyle='#9a9aa0'; ctx.stroke();
    ctx.globalAlpha = 1;
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