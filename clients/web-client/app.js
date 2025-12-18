let allRows = [];
let sortState = { key: 'char_code', dir: 1 }; // 1 asc, -1 desc

function qs(sel){ return document.querySelector(sel) }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)) }

function toast(text, error=false){
  const t = qs('#toast');
  t.textContent = text;
  t.className = 'toast ' + (error ? 'error' : 'ok');
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3200);
}

function setLoading(v){ qs('#loader').classList.toggle('hidden', !v); }

function fmt(v, digits=6){
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toFixed(digits);
}

function cmp(a,b){
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/* ================= Config ================= */
const KEY = 'cbr-microservices-config';

function getCfg(){
  const raw = localStorage.getItem(KEY);
  let cfg = {};
  try { cfg = raw ? JSON.parse(raw) : {}; } catch {}
  return {
    ratesBase: (cfg.ratesBase || '').replace(/\/$/,''),
    analyticsBase: (cfg.analyticsBase || '').replace(/\/$/,''),
    profileBase: (cfg.profileBase || '').replace(/\/$/,''),
    clientId: cfg.clientId || 'default',
  };
}

function setCfg(cfg){
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

function fillCfgForm(){
  const cfg = getCfg();
  qs('#cfg-rates').value = cfg.ratesBase || '';
  qs('#cfg-analytics').value = cfg.analyticsBase || '';
  qs('#cfg-profile').value = cfg.profileBase || '';
  qs('#cfg-client').value = cfg.clientId || 'default';
}

function readCfgForm(){
  return {
    ratesBase: qs('#cfg-rates').value.trim().replace(/\/$/,''),
    analyticsBase: qs('#cfg-analytics').value.trim().replace(/\/$/,''),
    profileBase: qs('#cfg-profile').value.trim().replace(/\/$/,''),
    clientId: (qs('#cfg-client').value.trim() || 'default'),
  };
}

async function testCfg(){
  const cfg = getCfg();
  const status = qs('#cfg-status');
  status.textContent = 'Проверка...';

  const checks = [];
  if (cfg.ratesBase) checks.push(fetch(`${cfg.ratesBase}/health`).then(r=>r.ok));
  if (cfg.analyticsBase) checks.push(fetch(`${cfg.analyticsBase}/health`).then(r=>r.ok));
  if (cfg.profileBase) checks.push(fetch(`${cfg.profileBase}/health`).then(r=>r.ok));

  try {
    const res = await Promise.allSettled(checks);
    const ok = res.filter(x => x.status === 'fulfilled' && x.value).length;
    status.textContent = `OK: ${ok}/${checks.length}`;
    if (ok === checks.length) toast('Все сервисы доступны');
    else toast('Часть сервисов не отвечает — проверь URL', true);
  } catch(e){
    status.textContent = 'Ошибка';
    toast('Ошибка проверки URL', true);
  }
}

async function loadCurrencies(){
  const cfg = getCfg();
  if (!cfg.ratesBase) return;
  try{
    const r = await fetch(`${cfg.ratesBase}/cbr/currencies`);
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    const dl = qs('#codes');
    dl.innerHTML = '';
    (data.items || []).forEach(it => {
      const opt = document.createElement('option');
      opt.value = it.code;
      dl.appendChild(opt);
    });
  } catch(e){
    // ignore
  }
}

/* ================= Daily rates ================= */
function renderTable(rows){
  const tbody = qs('#rates-table tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="code">${r.char_code}</td>
      <td class="num">${fmt(r.nominal, 0)}</td>
      <td class="num">${fmt(r.value, 6)}</td>
      <td class="num">${fmt(r.per1, 6)}</td>
      <td class="name">${r.name}</td>
    `;
    tbody.appendChild(tr);
  });
  qs('#count-label').textContent = `Показано: ${rows.length}`;
}

function applyFilterSort(){
  const f = qs('#filter').value.trim().toLowerCase();
  let rows = allRows.filter(r => !f || r.char_code.toLowerCase().includes(f) || r.name.toLowerCase().includes(f));
  rows.sort((x,y) => sortState.dir * cmp((sortState.key==='per1'?x.per1:x[sortState.key]), (sortState.key==='per1'?y.per1:y[sortState.key])));
  renderTable(rows);
}

async function loadRates(){
  const cfg = getCfg();
  if (!cfg.ratesBase) return toast('Сначала укажи Rates API URL', true);

  const date = qs('#date-input').value || '';
  setLoading(true);
  try{
    const url = new URL(`${cfg.ratesBase}/cbr/daily`);
    if (date) url.searchParams.set('date', date);
    const resp = await fetch(url.toString());
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    const reqIso = data.requested_date_iso || date || '';
    const cbrDateStr = data.date || '';
    const cbrIso = cbrDateStr ? cbrDateStr.split('.').reverse().join('-') : '';
    const same = reqIso && cbrIso ? (cbrIso === reqIso) : true;

    qs('#date-label').textContent = same
      ? (cbrDateStr ? `Дата ЦБ: ${cbrDateStr}` : '')
      : `Дата ЦБ: ${cbrDateStr} (запрошено: ${reqIso})`;

    const items = data.items || [];
    allRows = items.map(it => ({
      char_code: it.char_code,
      nominal: it.nominal,
      value: it.value,
      per1: (it.value && it.nominal) ? (it.value / it.nominal) : 0,
      name: it.name,
    }));

    // csv link
    const csv = new URL(`${cfg.ratesBase}/cbr/daily.csv`);
    if (date) csv.searchParams.set('date', date);
    qs('#btn-export').setAttribute('href', csv.toString());

    applyFilterSort();
    if (!same && reqIso) toast('Для запрошенной даты курсы недоступны — показана последняя дата ЦБ.');
  } catch(e){
    renderTable([]);
    toast(`Ошибка: ${e.message}`, true);
  } finally {
    setLoading(false);
  }
}

/* ================= Converter ================= */
async function doConvert(){
  const cfg = getCfg();
  if (!cfg.ratesBase) return toast('Сначала укажи Rates API URL', true);

  const fromCode = qs('#from-code').value.trim() || 'USD';
  const toCode   = qs('#to-code').value.trim() || 'RUB';
  const amount   = qs('#amount').value || '1';
  const date     = qs('#date-conv').value || '';

  const q = new URLSearchParams({ from_code: fromCode, to_code: toCode, amount });
  if (date) q.append('date', date);

  try{
    const resp = await fetch(`${cfg.ratesBase}/cbr/convert?${q.toString()}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    const rateStr = (data.rate != null) ? Number(data.rate).toFixed(6) : '—';
    const resStr  = (data.result != null) ? Number(data.result).toFixed(6) : '—';
    const box = qs('#conv-result');
    box.className = 'result ok grow';
    box.textContent = `Дата: ${data.date} · Курс ${data.from} → ${data.to}: ${rateStr} · ${amount} ${data.from} = ${resStr} ${data.to}`;
  } catch(e){
    const box = qs('#conv-result');
    box.className = 'result error grow';
    box.textContent = `Ошибка: ${e.message}`;
  }
}

/* ================= Favorites (profile-service) ================= */
function renderFav(items){
  const tbody = qs('#fav-table tbody');
  tbody.innerHTML = '';
  (items || []).forEach(it => {
    const tr = document.createElement('tr');
    const dt = it.created_at ? new Date(it.created_at).toLocaleString() : '';
    tr.innerHTML = `
      <td class="code">${it.code}</td>
      <td>${dt}</td>
      <td class="num">${it.id}</td>
      <td><button class="btn" data-del="${it.id}">Удалить</button></td>
    `;
    tbody.appendChild(tr);
  });
  qsa('#fav-table button[data-del]').forEach(btn => {
    btn.addEventListener('click', () => deleteFav(btn.getAttribute('data-del')));
  });
}

async function refreshFav(){
  const cfg = getCfg();
  if (!cfg.profileBase) return toast('Сначала укажи Profile API URL', true);
  try{
    const url = new URL(`${cfg.profileBase}/favorites`);
    url.searchParams.set('client_id', cfg.clientId);
    const r = await fetch(url.toString());
    const data = await r.json();
    renderFav(data);
  } catch(e){
    toast('Ошибка загрузки избранного', true);
  }
}

async function addFav(){
  const cfg = getCfg();
  if (!cfg.profileBase) return toast('Сначала укажи Profile API URL', true);
  const code = (qs('#fav-code').value || '').trim().toUpperCase();
  if (!code) return toast('Введите код валюты', true);
  try{
    const r = await fetch(`${cfg.profileBase}/favorites`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({client_id: cfg.clientId, code})
    });
    if (!r.ok){
      const j = await r.json().catch(()=>({detail:'error'}));
      throw new Error(j.detail || 'error');
    }
    toast('Добавлено в избранное');
    qs('#fav-code').value = '';
    await refreshFav();
  } catch(e){
    toast(`Ошибка: ${e.message}`, true);
  }
}

async function deleteFav(id){
  const cfg = getCfg();
  if (!cfg.profileBase) return;
  try{
    const r = await fetch(`${cfg.profileBase}/favorites/${id}`, {method:'DELETE'});
    if (!r.ok) throw new Error('delete failed');
    toast('Удалено');
    await refreshFav();
  } catch(e){
    toast('Ошибка удаления', true);
  }
}

/* ================= Analytics ================= */
async function doVolatility(){
  const cfg = getCfg();
  if (!cfg.analyticsBase) return toast('Сначала укажи Analytics API URL', true);

  const code = (qs('#ana-code').value || 'USD').trim();
  const from = qs('#ana-from').value;
  const to = qs('#ana-to').value;
  if (!from || !to) return toast('Укажи период', true);

  try{
    const url = new URL(`${cfg.analyticsBase}/analytics/volatility`);
    url.searchParams.set('code', code);
    url.searchParams.set('date_from', from);
    url.searchParams.set('date_to', to);
    url.searchParams.set('client_id', cfg.clientId);
    const r = await fetch(url.toString());
    const data = await r.json();
    if (data.error) throw new Error(data.error);

    qs('#ana-result').className = 'result ok grow';
    qs('#ana-result').textContent =
      `${data.code}: mean=${fmt(data.mean,6)} std=${fmt(data.std,6)} min=${fmt(data.min,6)} max=${fmt(data.max,6)}`;
  } catch(e){
    qs('#ana-result').className = 'result error grow';
    qs('#ana-result').textContent = `Ошибка: ${e.message}`;
  }
}

async function doForecast(){
  const cfg = getCfg();
  if (!cfg.analyticsBase) return toast('Сначала укажи Analytics API URL', true);
  const code = (qs('#ana-code').value || 'USD').trim();

  try{
    const url = new URL(`${cfg.analyticsBase}/analytics/forecast`);
    url.searchParams.set('code', code);
    url.searchParams.set('days', '7');
    url.searchParams.set('client_id', cfg.clientId);

    const r = await fetch(url.toString());
    const data = await r.json();
    if (data.error) throw new Error(data.error);

    const next = (data.forecast || []).slice(0,3).map(p => `${p.date}: ${fmt(p.rub_per_unit_pred,6)}`).join(' · ');
    qs('#ana-result').className = 'result ok grow';
    qs('#ana-result').textContent = `Прогноз ${data.code} (3 дня): ${next}`;
  } catch(e){
    qs('#ana-result').className = 'result error grow';
    qs('#ana-result').textContent = `Ошибка: ${e.message}`;
  }
}

/* ================= UI ================= */
function toggleTheme(){
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme-dark', document.documentElement.classList.contains('dark') ? '1':'0');
}

function bindSort(){
  qsa('#rates-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.getAttribute('data-sort');
      if (sortState.key === k) sortState.dir *= -1; else { sortState.key = k; sortState.dir = 1; }
      applyFilterSort();
    });
  });
}

function debounce(fn, ms=250){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); };
}

window.addEventListener('load', async () => {
  if (localStorage.getItem('theme-dark') === '1') document.documentElement.classList.add('dark');

  fillCfgForm();
  bindSort();

  qs('#toggle-theme').addEventListener('click', toggleTheme);
  qs('#cfg-save').addEventListener('click', () => { setCfg(readCfgForm()); toast('Сохранено'); loadCurrencies(); });
  qs('#cfg-test').addEventListener('click', async () => { setCfg(readCfgForm()); await testCfg(); await loadCurrencies(); });

  qs('#btn-load').addEventListener('click', loadRates);
  qs('#filter').addEventListener('input', debounce(applyFilterSort));
  qs('#btn-convert').addEventListener('click', doConvert);
  qs('#btn-swap').addEventListener('click', () => {
    const a = qs('#from-code').value; qs('#from-code').value = qs('#to-code').value; qs('#to-code').value = a;
  });

  qs('#btn-fav-add').addEventListener('click', addFav);
  qs('#btn-fav-refresh').addEventListener('click', refreshFav);

  qs('#btn-vol').addEventListener('click', doVolatility);
  qs('#btn-forecast').addEventListener('click', doForecast);

  await loadCurrencies();
});
