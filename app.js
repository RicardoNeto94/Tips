// v5: Accept WEEKLY cross‑tab CSV (Employee + date columns), optional weights matrix, pools editor, pivot & compute
(() => {
  const $ = sel => document.querySelector(sel);
  const weeklyFile = $("#weeklyFile");
  const weightsFile = $("#weightsFile");
  const alerts = $("#alerts");
  const poolEditor = $("#poolEditor");
  const stats = $("#stats");
  const dailyHead = $("#thead-daily"), dailyBody = $("#tbody-daily");
  const totalHead = $("#thead-total"), totalBody = $("#tbody-total");
  const chartCanvas = $("#chart");
  const recomputeBtn = $("#recompute");
  const useWeights = $("#useWeights");

  let dateCols = [];       // ['05/08','06/08',...]
  let employees = [];      // ['Kitchen','Krisu',...]
  let attendance = {};     // attendance[date][name] = 'Yes'|'No'
  let weights = {};        // weights[date][name] = numeric (optional)
  let pools = {};          // pools[date] = number

  weeklyFile.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if(!file) return;
    const text = await file.text();
    try {
      const {headers, rows} = parseCsvAuto(text);
      loadWeekly(headers, rows);
      renderPoolEditor();
      compute();
    } catch (err) {
      addAlert('Weekly CSV parse error: ' + err.message);
    }
  });

  weightsFile.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if(!file) return;
    const text = await file.text();
    try {
      const {headers, rows} = parseCsvAuto(text);
      loadWeights(headers, rows);
      compute();
    } catch (err) {
      addAlert('Weights CSV parse error: ' + err.message);
    }
  });

  recomputeBtn.addEventListener('click', () => {
    for (const d of dateCols) {
      const el = document.getElementById('pool_'+slug(d));
      if (el) pools[d] = num(el.value);
    }
    compute();
  });

  function loadWeekly(headers, rows){
    const empIdx = 0;
    const dateIdxs = headers.map((h,i) => ({h,i})).filter(x => /^\\d{2}\\/\\d{2}$/.test(x.h));
    if (!dateIdxs.length) throw new Error('No date-like columns found (expected headers like 05/08).');

    dateCols = dateIdxs.map(d => d.h);
    employees = rows.map(r => r[empIdx]).filter(x => String(x).trim().length>0);

    attendance = {};
    for (const {h,i} of dateIdxs) {
      attendance[h] = {};
      for (const r of rows) {
        const name = r[empIdx];
        attendance[h][name] = String(r[i]||'').trim();
      }
    }
    pools = {}; for (const d of dateCols) pools[d] = pools[d] || 0;
    clearAlerts();
    addAlert(`Loaded weekly CSV. Found ${employees.length} employees and ${dateCols.length} date columns.`);
  }

  function loadWeights(headers, rows){
    const empIdx = 0;
    const dateIdxs = headers.map((h,i) => ({h,i})).filter(x => /^\\d{2}\\/\\d{2}$/.test(x.h));
    if (!dateIdxs.length) throw new Error('No date-like columns in weights file.');

    weights = {};
    for (const {h,i} of dateIdxs) {
      weights[h] = {};
      for (const r of rows) {
        const name = r[empIdx];
        weights[h][name] = num(r[i]);
      }
    }
    clearAlerts();
    addAlert(`Loaded weights CSV. Using Value/4 weighting when enabled.`);
  }

  function renderPoolEditor(){
    poolEditor.innerHTML = dateCols.map(d => {
      const id = 'pool_'+slug(d);
      const val = pools[d] ?? '';
      return `<div class="pool">
        <div class="lbl">${esc(d)} Pool (€)</div>
        <input id="${id}" type="number" step="0.01" value="${esc(val)}" placeholder="0.00">
      </div>`;
    }).join('');
  }

  function compute(){
    if (!dateCols.length || !employees.length) return;
    const perDayRows = [];
    const totalsByName = new Map();
    let totalPoolAll = 0, allocatedAll = 0, unallocatedAll = 0;

    for (const d of dateCols) {
      const pool = num(pools[d]);
      totalPoolAll += pool;

      const kitchenYes = isYes((attendance[d]||{})['Kitchen'] || '');
      const kitchenAmount = kitchenYes ? 0.25 * pool : 0;
      const staffAvailable = pool - kitchenAmount;

      const present = employees.filter(n => n && n!=='Kitchen' && isYes((attendance[d]||{})[n]||''));

      const useW = useWeights.checked && weights && weights[d];
      const wPairs = present.map(n => {
        const v = useW ? (num(weights[d][n]) / 4) : 1;
        return {name:n, w: Math.max(0, v)};
      });
      const totalW = wPairs.reduce((a,b)=>a+b.w,0);

      for (const name of employees) {
        const base = {
          Date: d,
          Name: name,
          Attendance: (attendance[d]||{})[name] || '',
          Pool: pool ? pool.toFixed(2) : '',
          Kitchen25: kitchenAmount.toFixed(2),
          Staff75: (0.75*pool).toFixed(2),
          Weight: '',
          Allocation: '0.00',
        };
        if (name === 'Kitchen') {
          base.Weight = '';
          base.Allocation = kitchenAmount.toFixed(2);
        } else if (isYes(base.Attendance)) {
          const w = wPairs.find(x=>x.name===name)?.w || 0;
          base.Weight = w ? w.toFixed(2) : '';
          const share = totalW>0 ? (w/totalW)*staffAvailable : (present.length? (staffAvailable/present.length):0);
          base.Allocation = share.toFixed(2);
        }
        perDayRows.push(base);

        const prev = totalsByName.get(name) || { Name:name, Days:0, Total:0 };
        if (name==='Kitchen') {
          if (kitchenYes) { prev.Days += 1; prev.Total += kitchenAmount; }
        } else if (isYes(base.Attendance)) {
          prev.Days += 1; prev.Total += num(base.Allocation);
        }
        totalsByName.set(name, prev);
      }

      const allocatedThisDay = kitchenAmount + (totalW>0 || present.length>0 ? staffAvailable : 0);
      if (!(totalW>0 || present.length>0)) unallocatedAll += staffAvailable;
      allocatedAll += allocatedThisDay;
    }

    const cards = [
      {k:'Total Pool', v: euro(totalPoolAll)},
      {k:'Allocated', v: euro(allocatedAll)},
      {k:'Unallocated', v: euro(unallocatedAll)},
      {k:'Mode', v: useWeights.checked ? 'Weighted by Value/4' : 'Equal split among present'},
    ];
    stats.innerHTML = cards.map(c => `<div class="stat"><div class="k">${esc(c.k)}</div><div class="v">${esc(c.v)}</div></div>`).join('');

    renderTable(dailyHead, dailyBody, perDayRows, ['Date','Name','Attendance','Pool','Kitchen25','Staff75','Weight','Allocation'], ['Pool','Kitchen25','Staff75','Weight','Allocation']);
    const totals = Array.from(totalsByName.values()).sort((a,b)=>b.Total-a.Total);
    renderTable(totalHead, totalBody, totals, ['Name','Days','Total'], ['Total']);

    renderChart(chartCanvas, totals.map(t=>t.Name), totals.map(t=>t.Total));
  }

  // ===== Utils =====
  function parseCsvAuto(text){
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const firstLine = text.split(/\\r?\\n/)[0] || '';
    const cands = [',',';','\\t','|'];
    const counts = cands.map(d => (firstLine.match(new RegExp(escapeReg(d),'g'))||[]).length);
    const delim = cands[counts.indexOf(Math.max(...counts))] || ',';
    const rows = parseWithDelimiter(text, delim);
    const headers = rows[0] || [];
    const body = rows.slice(1).filter(r => r.length && r.some(v=>String(v).trim().length));
    return { headers, rows: body };
  }
  function parseWithDelimiter(text, delim){
    const out=[]; let i=0,cur='',row=[],inQ=false;
    while(i<text.length){
      const c=text[i];
      if(inQ){
        if(c=='\"'){ if(text[i+1]=='\"'){cur+='\"';i++;} else inQ=false; } else cur+=c;
      } else {
        if(c=='\"') inQ=true;
        else if(c===delim){ row.push(cur); cur=''; }
        else if(c=='\\n'){ row.push(cur); out.push(row.map(c=>String(c).replace(/\\u00A0/g,' ').trim())); row=[]; cur=''; }
        else if(c=='\\r'){}
        else cur+=c;
      }
      i++;
    }
    if(cur.length||row.length){ row.push(cur); out.push(row.map(c=>String(c).replace(/\\u00A0/g,' ').trim())); }
    return out;
  }
  function slug(s){ return String(s).replace(/[^a-z0-9]+/gi,'_'); }
  function isYes(v){ return /^yes$/i.test(String(v||'')); }
  function num(v){ if (v===null||v===undefined||v==='') return 0; const s=String(v).replace(/\\s+/g,'').replace(',','.'); const n=Number(s); return isFinite(n)?n:0; }
  function euro(n){ return formatNum(n) + ' €'; }
  function formatNum(v){ const n=typeof v==='number'?v:Number(v); return n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function esc(s){ return String(s).replace(/[&<>\"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c])); }
  function clearAlerts(){ alerts.innerHTML=''; }
  function addAlert(msg){ const d=document.createElement('div'); d.className='alert'; d.textContent=msg; alerts.appendChild(d); }
  function renderTable(headEl, bodyEl, rows, cols, rightCols=[]) {
    headEl.innerHTML = '<tr>' + cols.map(c=>`<th>${esc(c)}</th>`).join('') + '</tr>';
    bodyEl.innerHTML = rows.map(r => '<tr>' + cols.map(c => {
      const v = r[c] ?? '';
      const cls = rightCols.includes(c) ? ' class="right"' : '';
      return `<td${cls}>${esc(typeof v==='number' ? formatNum(v) : v)}</td>`;
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