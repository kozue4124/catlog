/* ねこログ – 猫の飲水量・尿量を毎日記録する */
(() => {
  'use strict';

  const APP_VERSION = '1.2.2';
  const STORAGE_KEY = 'catlog.v1';
  const APIKEY_KEY = 'catlog.apikey';
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const POOP_LABEL = { morning: '朝', noon: '昼', night: '夜' };
  const POOP_ORDER = ['morning', 'noon', 'night'];

  // ---------- state ----------
  const defaultSettings = () => ({
    catName: '', catWeightKg: null, defaultWaterMl: null, sheetDryG: null, evapMl: null
  });
  let state = load();
  let chartRange = 14;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { settings: { ...defaultSettings(), ...(parsed.settings || {}) }, entries: parsed.entries || {}, visits: parsed.visits || [] };
      }
    } catch (e) { console.warn('load failed', e); }
    return { settings: defaultSettings(), entries: {}, visits: [] };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { alert('保存に失敗しました。ブラウザの保存領域がいっぱいか、プライベートモードの可能性があります。'); }
  }

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const num = (v) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const fmt = (n, d = 0) => n == null ? '–' : n.toLocaleString('ja-JP', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const pad = (n) => String(n).padStart(2, '0');
  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayKey = () => toKey(new Date());
  const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
  const shortDate = (k) => { const d = fromKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const longDate = (k) => { const d = fromKey(k); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${DOW[d.getDay()]})`; };

  // 飲んだ量 = 入れた量 − 残った量 − 蒸発補正
  function waterDrank(e, s = state.settings) {
    if (e.waterIn == null || e.waterLeft == null) return null;
    const evap = s.evapMl || 0;
    return Math.max(0, e.waterIn - e.waterLeft - evap);
  }
  // 尿量 = 使用後シート − 新品シート(1g≒1ml)。直接入力があればそれを優先
  function urineAmount(e) {
    if (e.urineDirect != null) return e.urineDirect;
    if (e.sheetWet == null || e.sheetDry == null) return null;
    return Math.max(0, e.sheetWet - e.sheetDry);
  }
  const sortedKeys = () => Object.keys(state.entries).sort();
  // poop: undefined/null = 未記録, [] = なし, ['morning','night'] = 出た時間帯
  const poopText = (e) => {
    if (!e || e.poop == null) return '';
    if (e.poop.length === 0) return 'なし';
    return POOP_ORDER.filter((k) => e.poop.includes(k)).map((k) => POOP_LABEL[k]).join('・');
  };
  const hasWaterData = (e) => e.waterIn != null && e.waterLeft != null;
  const hasUrineData = (e) => (e.sheetWet != null && e.sheetDry != null) || e.urineDirect != null;
  const hasAnyData = (e) => e.waterIn != null || e.waterLeft != null || e.sheetWet != null || e.sheetDry != null
    || e.urineDirect != null || e.poop != null || (e.note && e.note.length > 0);

  // ---------- tabs ----------
  function showTab(name) {
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
    $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
    if (name === 'history') renderHistory();
    if (name === 'chart') renderChart();
    if (name === 'visits') renderVisits();
    if (name === 'settings') fillSettings();
    window.scrollTo({ top: 0 });
    hideTooltip();
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ---------- record form ----------
  const F = {
    date: $('#f-date'), waterIn: $('#f-waterIn'), waterLeft: $('#f-waterLeft'),
    sheetWet: $('#f-sheetWet'), sheetDry: $('#f-sheetDry'), urineDirect: $('#f-urineDirect'), note: $('#f-note')
  };

  let formPoop = null; // null | string[]
  function setPoop(v) {
    formPoop = v;
    $$('#poopChips .chip-toggle').forEach((c) => {
      const k = c.dataset.poop;
      const on = v != null && (k === 'none' ? v.length === 0 : v.includes(k));
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  $$('#poopChips .chip-toggle').forEach((c) => c.addEventListener('click', () => {
    const k = c.dataset.poop;
    if (k === 'none') { setPoop(formPoop != null && formPoop.length === 0 ? null : []); return; }
    let v = formPoop ? formPoop.filter((x) => x !== 'none') : [];
    v = v.includes(k) ? v.filter((x) => x !== k) : [...v, k];
    setPoop(v.length ? v : null);
  }));

  function readForm() {
    return {
      date: F.date.value,
      poop: formPoop ? formPoop.slice() : null,
      waterIn: num(F.waterIn.value), waterLeft: num(F.waterLeft.value),
      sheetWet: num(F.sheetWet.value), sheetDry: num(F.sheetDry.value),
      urineDirect: num(F.urineDirect.value),
      note: F.note.value.trim()
    };
  }

  function fillForm(dateKey) {
    const s = state.settings;
    const e = state.entries[dateKey];
    F.date.value = dateKey;
    if (e) {
      F.waterIn.value = e.waterIn ?? '';
      F.waterLeft.value = e.waterLeft ?? '';
      F.sheetWet.value = e.sheetWet ?? '';
      F.sheetDry.value = e.sheetDry ?? '';
      F.urineDirect.value = e.urineDirect ?? '';
      F.note.value = e.note || '';
      setPoop(e.poop ?? null);
      if (e.urineDirect != null) $('.more').open = true;
    } else {
      F.waterIn.value = s.defaultWaterMl ?? '';
      F.waterLeft.value = '';
      F.sheetWet.value = '';
      F.sheetDry.value = s.sheetDryG ?? '';
      F.urineDirect.value = '';
      F.note.value = '';
      setPoop(null);
    }
    updateCalc();
  }

  function updateCalc() {
    const e = readForm();
    const w = waterDrank(e);
    const u = urineAmount(e);
    $('#waterCalc').textContent = fmt(w);
    $('#urineCalc').textContent = fmt(u, 1);
    $('#waterResult').classList.toggle('is-warn', e.waterIn != null && e.waterLeft != null && e.waterLeft > e.waterIn);
    $('#urineResult').classList.toggle('is-warn', e.sheetWet != null && e.sheetDry != null && e.sheetWet < e.sheetDry);
    const evapHint = $('#evapHint');
    if (state.settings.evapMl) { evapHint.hidden = false; evapHint.textContent = `蒸発分 ${fmt(state.settings.evapMl)} ml を引いています(設定で変更できます)。`; }
    else evapHint.hidden = true;

    const k = e.date;
    const hint = $('#dateHint');
    if (!k) { hint.textContent = ''; return; }
    const saved = state.entries[k];
    $('#deleteEntryBtn').hidden = !saved;
    if (saved) hint.textContent = saved.draft ? 'この日の下書きを編集しています。数値が揃ったら「保存する」で確定してください。' : 'この日の保存済みの記録を編集しています。';
    else if (k > todayKey()) hint.textContent = '未来の日付です。';
    else hint.textContent = k === todayKey() ? '今日量った分(昨日のこの時間からの24時間)を記録します。' : `${longDate(k)} に量った分を記録します。`;
  }

  Object.values(F).forEach((el) => { el.addEventListener('input', updateCalc); });
  F.date.addEventListener('change', () => fillForm(F.date.value));

  function persistEntry(e, draft) {
    state.entries[e.date] = { ...e, draft, updatedAt: new Date().toISOString() };
    save();
    toast('#savedToast', draft ? '下書きを保存しました' : '保存しました');
    renderHeader();
    updateCalc();
  }

  $('#recordForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const e = readForm();
    if (!e.date) { alert('日付を入れてください。'); F.date.focus(); return; }
    const hasWater = hasWaterData(e), hasUrine = hasUrineData(e);
    if (!hasWater && !hasUrine) {
      alert('お水かおしっこ、どちらかの数値を入れてください。\nまだ量っていないときは「下書き保存」を使ってください。');
      return;
    }
    if (hasWater && e.waterLeft > e.waterIn && !confirm('残った量が入れた量より多くなっています。このまま保存しますか?')) return;
    if (e.sheetWet != null && e.sheetDry != null && e.sheetWet < e.sheetDry && !confirm('使用後のシートが新品より軽くなっています。このまま保存しますか?')) return;
    persistEntry(e, false);
  });

  $('#draftBtn').addEventListener('click', () => {
    const e = readForm();
    if (!e.date) { alert('日付を入れてください。'); F.date.focus(); return; }
    if (!hasAnyData(e)) { alert('何か 1 つ以上入力してから下書き保存してください。'); return; }
    persistEntry(e, true);
  });

  $('#deleteEntryBtn').addEventListener('click', () => {
    const k = F.date.value;
    if (!state.entries[k]) return;
    if (!confirm(`${longDate(k)} の記録を削除しますか?`)) return;
    delete state.entries[k]; save(); renderHeader(); fillForm(k);
  });

  $('#clearFormBtn').addEventListener('click', () => {
    const k = F.date.value || todayKey();
    if (state.entries[k] && !confirm('保存済みのデータは残したまま、入力欄だけを初期値に戻します。よろしいですか?')) return;
    const s = state.settings;
    F.waterIn.value = s.defaultWaterMl ?? '';
    F.waterLeft.value = '';
    F.sheetWet.value = '';
    F.sheetDry.value = s.sheetDryG ?? '';
    F.urineDirect.value = '';
    F.note.value = '';
    setPoop(null);
    updateCalc();
  });

  let toastTimer;
  function toast(sel, msg) {
    const el = $(sel);
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // ---------- header ----------
  function renderHeader() {
    const s = state.settings;
    $('#appTitle').textContent = s.catName ? `${s.catName}のログ` : 'ねこログ';
    const keys = sortedKeys();
    const drafts = keys.filter((k) => state.entries[k].draft).length;
    $('#appSub').textContent = keys.length ? `${keys.length}日分の記録${drafts ? `(下書き ${drafts})` : ''}` : '';
  }

  // ---------- history ----------
  function renderHistory() {
    const list = $('#historyList');
    const keys = sortedKeys().reverse();
    $('#historyEmpty').hidden = keys.length > 0;
    list.innerHTML = '';
    for (const k of keys) {
      const e = state.entries[k];
      const li = document.createElement('li');
      const d = fromKey(k);
      const w = waterDrank(e), u = urineAmount(e);
      const pt = poopText(e);
      li.innerHTML = `
        <div class="h-date">${shortDate(k)}<span class="h-dow">(${DOW[d.getDay()]}) ${d.getFullYear()}</span>${e.draft ? '<span class="badge badge-draft">下書き</span>' : ''}</div>
        <button type="button" class="h-del" aria-label="${longDate(k)} の記録を削除">×</button>
        <div class="h-vals">
          <span class="h-water${w == null ? ' is-missing' : ''}"><svg class="ico ico-water" aria-hidden="true"><use href="#i-drop"/></svg>${w == null ? '未入力' : fmt(w) + ' ml'}</span>
          <span class="h-urine${u == null ? ' is-missing' : ''}"><svg class="ico ico-urine" aria-hidden="true"><use href="#i-drop"/></svg>${u == null ? '未入力' : fmt(u, 1) + ' ml'}</span>
        </div>
        <div class="h-poop"><svg class="ico ico-poop" aria-hidden="true"><use href="#i-poop"/></svg>${pt ? pt : '<span class="is-missing">未記録</span>'}</div>
        <button type="button" class="h-edit" aria-label="${longDate(k)} の記録を編集">編集</button>
        ${e.note ? `<div class="h-note"></div>` : ''}`;
      if (e.note) li.querySelector('.h-note').textContent = e.note;
      li.addEventListener('click', (ev) => {
        if (ev.target.closest('.h-del')) return;
        fillForm(k); showTab('record');
      });
      li.querySelector('.h-del').addEventListener('click', () => {
        if (!confirm(`${longDate(k)} の記録を削除しますか?`)) return;
        delete state.entries[k]; save(); renderHistory(); renderHeader();
      });
      list.appendChild(li);
    }
  }

  // ---------- chart ----------
  $$('.range-row .chip').forEach((c) => c.addEventListener('click', () => {
    chartRange = Number(c.dataset.range);
    $$('.range-row .chip').forEach((x) => x.classList.toggle('is-active', x === c));
    renderChart();
  }));

  function seriesFor(range) {
    const end = todayKey();
    const start = addDays(end, -(range - 1));
    const days = [];
    for (let k = start; k <= end; k = addDays(k, 1)) {
      const e = state.entries[k];
      days.push({ key: k, water: e ? waterDrank(e) : null, urine: e ? urineAmount(e) : null, poop: e ? (e.poop ?? null) : null });
    }
    return days;
  }
  const avg = (arr) => { const v = arr.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

  function renderChart() {
    const days = seriesFor(chartRange);
    const kg = state.settings.catWeightKg;
    const wAvg = avg(days.map((d) => d.water));
    const uAvg = avg(days.map((d) => d.urine));
    const last7 = seriesFor(7);
    const w7 = avg(last7.map((d) => d.water)), u7 = avg(last7.map((d) => d.urine));

    const perKg = (v) => (kg && v != null) ? `${fmt(v / kg, 1)} ml/kg/日` : '';
    const recorded = days.filter((d) => d.poop != null);
    const poopDays = recorded.filter((d) => d.poop.length > 0).length;
    const slotCount = (k) => recorded.filter((d) => d.poop.includes(k)).length;
    const poopKpi = recorded.length
      ? `<div class="kpi kpi-wide"><div class="kpi-label"><svg class="ico ico-poop" aria-hidden="true"><use href="#i-poop"/></svg>うんち(${chartRange}日間)</div>
          <div class="kpi-value">${poopDays}<small>日 / 記録${recorded.length}日</small>
          <small>朝 ${slotCount('morning')} ・ 昼 ${slotCount('noon')} ・ 夜 ${slotCount('night')} 回</small></div></div>`
      : '';
    $('#kpiRow').innerHTML = poopKpi + `
      <div class="kpi"><div class="kpi-label"><svg class="ico ico-water" aria-hidden="true"><use href="#i-drop"/></svg>飲水 直近7日平均</div>
        <div class="kpi-value">${fmt(w7)}<small>ml/日</small></div><div class="kpi-sub">${perKg(w7) || '&nbsp;'}</div></div>
      <div class="kpi"><div class="kpi-label"><svg class="ico ico-urine" aria-hidden="true"><use href="#i-drop"/></svg>尿 直近7日平均</div>
        <div class="kpi-value">${fmt(u7)}<small>ml/日</small></div><div class="kpi-sub">${perKg(u7) || '&nbsp;'}</div></div>`;

    drawBars($('#waterChart'), days.map((d) => ({ key: d.key, v: d.water })), wAvg, 'var(--water)', '飲んだ量');
    drawBars($('#urineChart'), days.map((d) => ({ key: d.key, v: d.urine })), uAvg, 'var(--urine)', 'おしっこ');

    const tb = $('#chartTable tbody');
    tb.innerHTML = days.slice().reverse().filter((d) => d.water != null || d.urine != null || d.poop != null)
      .map((d) => `<tr><td>${longDate(d.key)}</td><td>${fmt(d.water)}</td><td>${fmt(d.urine, 1)}</td><td>${poopText({ poop: d.poop }) || '–'}</td></tr>`).join('')
      || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">この期間の記録はありません</td></tr>';

    const ref = $('#refNote');
    const kgNote = kg ? '' : '<p>設定で体重を入れると、体重1kgあたりの量も表示されます。</p>';
    ref.innerHTML = `
      <p><b>目安</b>: 一般に、飲水量が <b>100 ml/kg/日</b> を超える状態を「多飲」、尿量が <b>50 ml/kg/日</b> を超える状態を「多尿」と呼びます。
      ウェットフードを食べる猫は水を飲む量が少なくなるのが普通です。</p>
      <p>数字そのものより「いつもより増えてきた/減ってきた」という変化が大切です。気になる傾向が続くときは、このグラフやCSVを持って獣医師に相談してください。</p>
      ${kgNote}`;
  }

  function drawBars(svg, data, average, color, name) {
    const W = svg.clientWidth || 320, H = 200;
    const m = { top: 14, right: 8, bottom: 22, left: 36 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs = {}, text) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text != null) n.textContent = text;
      return n;
    };

    const vals = data.map((d) => d.v).filter((v) => v != null);
    if (!vals.length) {
      svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'nodata' }, 'この期間の記録はありません'));
      return;
    }
    const maxV = Math.max(...vals, average || 0);
    const step = niceStep(maxV / 3);
    const top = Math.max(step, Math.ceil(maxV / step) * step);
    const y = (v) => m.top + ih - (v / top) * ih;
    const n = data.length;
    const slot = iw / n;
    const gap = Math.max(2, Math.min(6, slot * 0.25));
    const bw = Math.max(2, slot - gap);

    // grid + y axis
    const grid = el('g', { class: 'grid' });
    const axis = el('g', { class: 'axis' });
    for (let v = 0; v <= top + 1e-9; v += step) {
      grid.appendChild(el('line', { x1: m.left, x2: W - m.right, y1: y(v), y2: y(v) }));
      axis.appendChild(el('text', { x: m.left - 6, y: y(v) + 4, 'text-anchor': 'end' }, fmt(v)));
    }
    svg.appendChild(grid); svg.appendChild(axis);

    // x labels (sparse)
    const every = n <= 7 ? 1 : n <= 14 ? 2 : n <= 30 ? 5 : 15;
    data.forEach((d, i) => {
      if ((n - 1 - i) % every === 0) {
        axis.appendChild(el('text', { x: m.left + slot * i + slot / 2, y: H - 6, 'text-anchor': 'middle' }, shortDate(d.key)));
      }
    });

    // bars
    const bars = el('g');
    const hits = el('g');
    data.forEach((d, i) => {
      const x = m.left + slot * i + gap / 2;
      if (d.v != null) {
        const h = Math.max(0, y(0) - y(d.v));
        const r = Math.min(4, bw / 2, h);
        const yTop = y(d.v);
        // rounded top only, flat bottom anchored to baseline
        const path = `M${x},${y(0)} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${y(0)} Z`;
        bars.appendChild(el('path', { d: path, fill: color, class: 'bar', 'data-i': i }));
      }
      const hit = el('rect', { x: m.left + slot * i, y: m.top, width: slot, height: ih, class: 'hit' });
      const show = (ev) => {
        bars.querySelectorAll('.bar').forEach((b) => b.classList.toggle('is-dim', Number(b.dataset.i) !== i));
        showTooltip(ev, `${longDate(d.key)}<br>${name} <b>${d.v == null ? '記録なし' : fmt(d.v, 1) + ' ml'}</b>`);
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', () => { bars.querySelectorAll('.bar').forEach((b) => b.classList.remove('is-dim')); hideTooltip(); });
      hits.appendChild(hit);
    });
    svg.appendChild(bars);

    // average line + label
    if (average != null) {
      svg.appendChild(el('line', { x1: m.left, x2: W - m.right, y1: y(average), y2: y(average), class: 'avg' }));
      svg.appendChild(el('text', { x: W - m.right, y: y(average) - 4, 'text-anchor': 'end', class: 'label' }, `平均 ${fmt(average)}`));
    }
    // baseline
    svg.appendChild(el('line', { x1: m.left, x2: W - m.right, y1: y(0), y2: y(0), stroke: 'var(--border)' }));
    svg.appendChild(hits);
  }

  function niceStep(raw) {
    if (!(raw > 0)) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * p;
  }

  const tip = $('#tooltip');
  function showTooltip(ev, html) {
    tip.innerHTML = html; tip.hidden = false;
    const pad = 12;
    let x = ev.clientX + pad, yy = ev.clientY - 44;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (yy < 8) yy = ev.clientY + pad;
    tip.style.left = `${x}px`; tip.style.top = `${yy}px`;
  }
  function hideTooltip() { tip.hidden = true; }
  document.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('.hit')) hideTooltip(); });
  window.addEventListener('resize', () => { if (!$('#view-chart').hidden) renderChart(); });

  // ---------- settings ----------
  const S = {
    catName: $('#s-catName'), catWeight: $('#s-catWeight'), defaultWater: $('#s-defaultWater'),
    sheetDry: $('#s-sheetDry'), evap: $('#s-evap')
  };
  function fillSettings() {
    const s = state.settings;
    S.catName.value = s.catName || '';
    S.catWeight.value = s.catWeightKg ?? '';
    S.defaultWater.value = s.defaultWaterMl ?? '';
    S.sheetDry.value = s.sheetDryG ?? '';
    S.evap.value = s.evapMl ?? '';
    $('#s-apiKey').value = getApiKey();
  }
  function getApiKey() { try { return localStorage.getItem(APIKEY_KEY) || ''; } catch (e) { return ''; } }
  function setApiKey(k) { try { if (k) localStorage.setItem(APIKEY_KEY, k); else localStorage.removeItem(APIKEY_KEY); } catch (e) {} }
  $('#settingsForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    state.settings = {
      catName: S.catName.value.trim(),
      catWeightKg: num(S.catWeight.value),
      defaultWaterMl: num(S.defaultWater.value),
      sheetDryG: num(S.sheetDry.value),
      evapMl: num(S.evap.value)
    };
    setApiKey($('#s-apiKey').value.trim());
    save(); renderHeader(); toast('#settingsToast', '設定を保存しました');
    // 今日の未保存フォームに初期値を反映
    if (!state.entries[F.date.value]) {
      if (F.waterIn.value === '' && state.settings.defaultWaterMl != null) F.waterIn.value = state.settings.defaultWaterMl;
      if (F.sheetDry.value === '' && state.settings.sheetDryG != null) F.sheetDry.value = state.settings.sheetDryG;
    }
    updateCalc();
  });

  // ---------- export / import ----------
  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  $('#exportCsvBtn').addEventListener('click', () => {
    const head = ['日付', '入れた水ml', '残った水ml', '飲んだ量ml', '使用後シートg', '新品シートg', '尿量(直接入力)ml', '尿量ml', 'うんち', '下書き', 'メモ'];
    const rows = sortedKeys().map((k) => {
      const e = state.entries[k];
      return [k, e.waterIn, e.waterLeft, waterDrank(e), e.sheetWet, e.sheetDry, e.urineDirect, urineAmount(e), poopText(e), e.draft ? '下書き' : '', e.note].map(csvCell).join(',');
    });
    download(`catlog-${todayKey()}.csv`, '﻿' + [head.join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  });
  $('#exportJsonBtn').addEventListener('click', async () => {
    const photos = {};
    for (const v of state.visits) {
      if (!v.photoId) continue;
      const blob = await photoGet(v.photoId);
      if (blob) photos[v.photoId] = await blobToDataUrl(blob);
    }
    download(`catlog-backup-${todayKey()}.json`, JSON.stringify({ app: 'catlog', version: APP_VERSION, exportedAt: new Date().toISOString(), ...state, photos }), 'application/json');
  });
  $('#exportVisitsCsvBtn').addEventListener('click', () => {
    const head = ['日付', '病院名', '合計金額', '診療内容', 'メモ'];
    const rows = state.visits.slice().sort((a, b) => a.date < b.date ? -1 : 1).map((v) =>
      [v.date, v.clinic, v.total, (v.items || []).map((i) => i.amount != null ? `${i.name} ${i.amount}` : i.name).join(' / '), v.note].map(csvCell).join(','));
    download(`catlog-visits-${todayKey()}.csv`, '\uFEFF' + [head.join(','), ...rows].join('\r\n'), 'text/csv;charset=utf-8');
  });
  $('#importFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data.entries !== 'object') throw new Error('形式が違います');
      const n = Object.keys(data.entries).length;
      const nv = Array.isArray(data.visits) ? data.visits.length : 0;
      const mode = confirm(`${n}日分の記録${nv ? `と通院 ${nv} 件` : ''}が見つかりました。\n「OK」= 今あるデータに追加・上書き(マージ)\n「キャンセル」= 読み込まない`);
      if (!mode) return;
      state.entries = { ...state.entries, ...data.entries };
      if (data.settings) { const { apiKey, ...rest } = data.settings; state.settings = { ...state.settings, ...rest }; }
      if (nv) {
        const byId = new Map(state.visits.map((v) => [v.id, v]));
        for (const v of data.visits) byId.set(v.id, v);
        state.visits = Array.from(byId.values());
        if (data.photos) {
          for (const [id, dataUrl] of Object.entries(data.photos)) {
            try { await photoPut(id, await (await fetch(dataUrl)).blob()); } catch (e) { console.warn('photo import failed', id, e); }
          }
        }
      }
      save(); renderHeader(); fillSettings(); alert('読み込みました。');
    } catch (e) { alert('読み込めませんでした: ' + e.message); }
  });
  $('#wipeBtn').addEventListener('click', () => {
    if (!confirm('すべての記録と設定を削除します。元に戻せません。よろしいですか?')) return;
    if (!confirm('本当に削除しますか?(先にバックアップをおすすめします)')) return;
    state = { settings: defaultSettings(), entries: {}, visits: [] };
    setApiKey('');
    photoClearAll().catch(() => {});
    save(); renderHeader(); fillSettings(); fillForm(todayKey()); alert('削除しました。');
  });


  // ====================================================================
  // 通院の記録
  // ====================================================================

  // ---- 写真の保存(IndexedDB) ----
  const DB_NAME = 'catlog', DB_VER = 1, PHOTO_STORE = 'photos';
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('indexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idb(mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, mode);
      const st = tx.objectStore(PHOTO_STORE);
      const r = fn(st);
      tx.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }
  const photoPut = (id, blob) => idb('readwrite', (st) => st.put(blob, id));
  const photoGet = (id) => idb('readonly', (st) => st.get(id)).catch(() => null);
  const photoDel = (id) => idb('readwrite', (st) => st.delete(id)).catch(() => {});
  const photoClearAll = () => idb('readwrite', (st) => st.clear());
  const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  // 写真を縮小して JPEG に(保存容量と送信サイズを抑える)
  async function shrinkImage(file, maxEdge = 1568, quality = 0.85) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
      return blob || file;
    } finally { URL.revokeObjectURL(url); }
  }

  // ---- フォーム状態 ----
  const VF = { date: $('#v-date'), total: $('#v-total'), clinic: $('#v-clinic'), note: $('#v-note'), raw: $('#v-raw') };
  let editingVisitId = null;
  let pendingPhoto = null;        // { blob, id } 保存前の写真
  let pendingPhotoRemoved = false;
  let previewUrl = null;

  function setPreview(blob) {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    const wrap = $('#photoPreview'), img = $('#photoImg');
    if (blob) { previewUrl = URL.createObjectURL(blob); img.src = previewUrl; wrap.hidden = false; }
    else { img.removeAttribute('src'); wrap.hidden = true; }
    $('#photoRemoveBtn').hidden = !blob;
    // AI 読み取り(有料)は API キーを登録しているときだけ表示する
    $('#ocrBtn').hidden = !blob || !getApiKey();
    $('#ocrHint').textContent = '';
  }

  function itemRow(item = { name: '', amount: null }) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<input type="text" class="it-name" placeholder="例 再診料"><input type="number" class="it-amount" inputmode="numeric" step="1" min="0" placeholder="円"><button type="button" class="row-del" aria-label="この項目を削除">×</button>`;
    row.querySelector('.it-name').value = item.name || '';
    row.querySelector('.it-amount').value = item.amount ?? '';
    row.querySelector('.row-del').addEventListener('click', () => row.remove());
    return row;
  }
  function setItems(items) {
    const box = $('#itemRows'); box.innerHTML = '';
    (items && items.length ? items : [{ name: '', amount: null }]).forEach((it) => box.appendChild(itemRow(it)));
  }
  function readItems() {
    return $$('#itemRows .item-row').map((r) => ({ name: r.querySelector('.it-name').value.trim(), amount: num(r.querySelector('.it-amount').value) }))
      .filter((it) => it.name || it.amount != null);
  }
  $('#addItemBtn').addEventListener('click', () => { $('#itemRows').appendChild(itemRow()); $('#itemRows .item-row:last-child .it-name').focus(); });

  async function openVisitForm(visit) {
    editingVisitId = visit ? visit.id : null;
    pendingPhoto = null; pendingPhotoRemoved = false;
    $('#visitFormTitle').textContent = visit ? '通院の記録を編集' : '通院を記録';
    VF.date.value = visit ? visit.date : todayKey();
    VF.total.value = visit && visit.total != null ? visit.total : '';
    VF.clinic.value = visit ? (visit.clinic || '') : (lastClinic() || '');
    VF.note.value = visit ? (visit.note || '') : '';
    VF.raw.value = visit ? (visit.rawText || '') : '';
    $('#parseHint').textContent = '';
    setItems(visit ? visit.items : []);
    $('#visitDeleteBtn').hidden = !visit;
    setPreview(visit && visit.photoId ? await photoGet(visit.photoId) : null);
    $('#visitForm').hidden = false;
    $('#visitsHead').hidden = true;
    $('#visitList').hidden = true; $('#visitsEmpty').hidden = true;
    window.scrollTo({ top: 0 });
  }
  function closeVisitForm() {
    $('#visitForm').hidden = true;
    $('#visitsHead').hidden = false;
    setPreview(null);
    pendingPhoto = null; editingVisitId = null;
    renderVisits();
  }
  const lastClinic = () => { const v = state.visits.slice().sort((a, b) => a.date < b.date ? 1 : -1).find((x) => x.clinic); return v ? v.clinic : ''; };

  $('#newVisitBtn').addEventListener('click', () => openVisitForm(null));
  $('#visitCancelBtn').addEventListener('click', closeVisitForm);

  async function onPhotoPicked(ev) {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    try {
      const blob = await shrinkImage(file);
      pendingPhoto = { blob, id: uid() };
      pendingPhotoRemoved = false;
      setPreview(blob);
    } catch (e) { alert('写真を読み込めませんでした。'); }
  }
  $('#photoCamera').addEventListener('change', onPhotoPicked);
  $('#photoFile').addEventListener('change', onPhotoPicked);
  $('#photoRemoveBtn').addEventListener('click', () => { pendingPhoto = null; pendingPhotoRemoved = true; setPreview(null); });
  $('#photoImg').addEventListener('click', () => { if (previewUrl) openLightbox(previewUrl); });

  $('#visitForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const date = VF.date.value;
    if (!date) { alert('日付を入れてください。'); VF.date.focus(); return; }
    const existing = editingVisitId ? state.visits.find((v) => v.id === editingVisitId) : null;
    const visit = {
      id: existing ? existing.id : uid(),
      date,
      clinic: VF.clinic.value.trim(),
      total: num(VF.total.value),
      items: readItems(),
      note: VF.note.value.trim(),
      rawText: VF.raw.value.trim(),
      photoId: existing ? existing.photoId : null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    try {
      if (pendingPhoto) {
        await photoPut(pendingPhoto.id, pendingPhoto.blob);
        if (visit.photoId && visit.photoId !== pendingPhoto.id) await photoDel(visit.photoId);
        visit.photoId = pendingPhoto.id;
      } else if (pendingPhotoRemoved && visit.photoId) {
        await photoDel(visit.photoId); visit.photoId = null;
      }
    } catch (e) { alert('写真の保存に失敗しました。写真なしで保存します。'); visit.photoId = null; }
    if (existing) Object.assign(existing, visit); else state.visits.push(visit);
    save();
    closeVisitForm();
  });

  $('#visitDeleteBtn').addEventListener('click', async () => {
    const v = state.visits.find((x) => x.id === editingVisitId);
    if (!v || !confirm(`${longDate(v.date)} の通院記録を削除しますか?`)) return;
    if (v.photoId) await photoDel(v.photoId);
    state.visits = state.visits.filter((x) => x.id !== v.id);
    save(); closeVisitForm();
  });

  // ---- 一覧 ----
  const yen = (n) => n == null ? '–' : '¥' + Math.round(n).toLocaleString('ja-JP');
  const thumbUrls = new Map();
  async function renderVisits() {
    const list = $('#visitList');
    const visits = state.visits.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt < b.createdAt ? 1 : -1)));
    $('#visitsEmpty').hidden = visits.length > 0 || !$('#visitForm').hidden;
    list.hidden = !$('#visitForm').hidden;
    const year = new Date().getFullYear();
    const thisYear = visits.filter((v) => v.date.startsWith(String(year)));
    const sum = thisYear.reduce((a, v) => a + (v.total || 0), 0);
    $('#visitsSummary').textContent = visits.length ? `${year}年: ${thisYear.length}回 ・ 合計 ${yen(sum)}(全 ${visits.length} 件)` : '写真を撮って日付・金額・診療内容を残せます。';
    list.innerHTML = '';
    for (const v of visits) {
      const li = document.createElement('li');
      const items = (v.items || []).map((i) => i.name).filter(Boolean);
      li.innerHTML = `
        <div class="v-thumb">${v.photoId ? '' : '🏥'}</div>
        <div class="v-top"><span class="v-date">${shortDate(v.date)}<span class="h-dow">(${DOW[fromKey(v.date).getDay()]}) ${fromKey(v.date).getFullYear()}</span></span><span class="v-total">${yen(v.total)}</span></div>
        <div class="v-clinic"></div>
        <div class="v-items"></div>
        ${v.note ? '<div class="v-note"></div>' : ''}`;
      li.querySelector('.v-clinic').textContent = v.clinic || '';
      li.querySelector('.v-items').textContent = items.length ? items.join('・') : '診療内容 未入力';
      if (v.note) li.querySelector('.v-note').textContent = v.note;
      li.addEventListener('click', (ev) => { if (ev.target.closest('.v-thumb img')) return; openVisitForm(v); });
      list.appendChild(li);
      if (v.photoId) {
        photoGet(v.photoId).then((blob) => {
          if (!blob) { li.querySelector('.v-thumb').textContent = '🏥'; return; }
          let url = thumbUrls.get(v.photoId);
          if (!url) { url = URL.createObjectURL(blob); thumbUrls.set(v.photoId, url); }
          const img = document.createElement('img'); img.src = url; img.alt = '明細の写真';
          img.addEventListener('click', () => openLightbox(url));
          li.querySelector('.v-thumb').appendChild(img);
        });
      }
    }
  }

  function openLightbox(url) { $('#lightboxImg').src = url; $('#lightbox').hidden = false; }
  function closeLightbox() { $('#lightbox').hidden = true; $('#lightboxImg').removeAttribute('src'); }
  $('#lightbox').addEventListener('click', closeLightbox);
  $('#lightboxClose').addEventListener('click', closeLightbox);

  // ---- 文字からの読み取り(無料・端末内) ----
  function applyParsed(r, overwrite) {
    const hint = $('#parseHint');
    let filled = [];
    if (r.date && (overwrite || !VF.date.value || VF.date.value === todayKey())) { VF.date.value = r.date; filled.push('日付'); }
    if (r.total != null && (overwrite || VF.total.value === '')) { VF.total.value = Math.round(r.total); filled.push('合計金額'); }
    if (r.clinic && (overwrite || VF.clinic.value === '' || VF.clinic.value === lastClinic())) { VF.clinic.value = r.clinic; filled.push('病院名'); }
    const curItems = readItems();
    if (r.items && r.items.length && (overwrite || curItems.length === 0)) { setItems(r.items); filled.push(`診療内容 ${r.items.length} 件`); }
    if (filled.length) hint.textContent = `${filled.join('・')} を入れました。内容を確認して、違っていれば直してから保存してください。`;
    else hint.textContent = '文字から日付や金額を見つけられませんでした。手で入力してください。';
    return filled.length;
  }
  function parseRaw(overwrite) {
    const text = VF.raw.value.trim();
    if (!text) { $('#parseHint').textContent = '明細の文字を入れてください。'; return; }
    if (typeof window.parseReceiptText !== 'function') { $('#parseHint').textContent = '読み取り機能を読み込めませんでした。アプリを開き直してください。'; return; }
    applyParsed(window.parseReceiptText(text), overwrite);
  }
  $('#parseTextBtn').addEventListener('click', () => parseRaw(true));
  let rawTimer = null;
  VF.raw.addEventListener('input', () => {
    clearTimeout(rawTimer);
    rawTimer = setTimeout(() => { if (VF.raw.value.trim().length >= 10) parseRaw(false); }, 700);
  });

  // ---- AI 読み取り(Claude API) ----
  const RECEIPT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['date', 'clinic', 'total', 'items', 'pet_name', 'notes'],
    properties: {
      date: { type: ['string', 'null'], description: '診療日または発行日。YYYY-MM-DD 形式。読めなければ null' },
      clinic: { type: ['string', 'null'], description: '病院名。読めなければ null' },
      total: { type: ['number', 'null'], description: '実際に支払った合計金額(税込、円)。読めなければ null' },
      items: {
        type: 'array',
        description: '診療明細の各行。小計・税・合計の行は含めない',
        items: {
          type: 'object', additionalProperties: false, required: ['name', 'amount'],
          properties: {
            name: { type: 'string', description: '項目名。括弧内の補足行(薬品名や袋数など)は親項目の名前に含める' },
            amount: { type: ['number', 'null'], description: 'その行の金額(円)。読めなければ null' }
          }
        }
      },
      pet_name: { type: ['string', 'null'] },
      notes: { type: ['string', 'null'], description: '次回予約や注意書きなど、記録に残す価値のある補足。なければ null' }
    }
  };
  const OCR_PROMPT = 'この写真は日本の動物病院の診療明細書(領収書)です。日付、病院名、支払った合計金額(税込)、診療明細の各項目(項目名と金額)を読み取ってください。小計・消費税・合計の行は items に含めないでください。括弧書きの補足行(例: 薬品名や袋数)は、その直前の項目名に含めて 1 行にまとめてください。読めない箇所は null にしてください。';

  async function extractReceipt(blob) {
    const key = getApiKey();
    if (!key) throw new Error('NO_KEY');
    const dataUrl = await blobToDataUrl(blob);
    const b64 = dataUrl.split(',')[1];
    const body = {
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: OCR_PROMPT }
      ] }]
    };
    const call = async (payload) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2026-10-21',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(payload)
    });
    let res = await call(body);
    if (res.status === 400) {
      // 構造化出力が使えない場合は通常出力で再試行し、本文から JSON を取り出す
      const errText = await res.text();
      if (/output_config|format/i.test(errText)) {
        const { output_config, ...rest } = body;
        rest.messages[0].content[1].text += ' 次の JSON だけを出力してください: ' + JSON.stringify(RECEIPT_SCHEMA.properties);
        res = await call(rest);
      } else {
        throw new Error('API_400: ' + errText.slice(0, 200));
      }
    }
    if (res.status === 401) throw new Error('AUTH');
    if (res.status === 429) throw new Error('RATE');
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    const msg = await res.json();
    if (msg.stop_reason === 'refusal') throw new Error('REFUSED');
    const text = (msg.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('PARSE');
    return JSON.parse(m[0]);
  }

  $('#ocrBtn').addEventListener('click', async () => {
    const blob = pendingPhoto ? pendingPhoto.blob : (editingVisitId ? await photoGet((state.visits.find((v) => v.id === editingVisitId) || {}).photoId) : null);
    if (!blob) return;
    if (!getApiKey()) { alert('設定で API キーを登録すると、写真から自動で読み取れます。'); return; }
    const btn = $('#ocrBtn'), hint = $('#ocrHint');
    btn.disabled = true; btn.textContent = '読み取り中…(10〜30秒)'; hint.textContent = '';
    try {
      const r = await extractReceipt(blob);
      if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) VF.date.value = r.date;
      if (r.clinic) VF.clinic.value = r.clinic;
      if (r.total != null) VF.total.value = Math.round(r.total);
      if (Array.isArray(r.items) && r.items.length) setItems(r.items.map((i) => ({ name: i.name || '', amount: i.amount })));
      if (r.notes && !VF.note.value) VF.note.value = r.notes;
      hint.textContent = '読み取りました。内容を確認して、違っていれば直してから保存してください。';
    } catch (e) {
      const code = String(e.message || e);
      hint.textContent =
        code === 'AUTH' ? 'API キーが正しくないようです。設定を確認してください。' :
        code === 'RATE' ? '混み合っています。少し待ってからもう一度お試しください。' :
        code === 'REFUSED' ? '読み取りが拒否されました。別の写真でお試しください。' :
        code === 'PARSE' ? '読み取り結果を解釈できませんでした。もう一度お試しください。' :
        code.startsWith('API_400') ? '読み取りに失敗しました: ' + code.slice(9) :
        '読み取りに失敗しました。通信状態を確認してもう一度お試しください。';
      console.warn('ocr failed', e);
    } finally {
      btn.disabled = false; btn.textContent = '✨ 写真から日付・金額・内容を読み取る';
    }
  });

  // ---------- init ----------
  $('#appVersion').textContent = APP_VERSION;
  $('#updateBtn').addEventListener('click', async () => {
    const btn = $('#updateBtn');
    btn.disabled = true; btn.textContent = '確認中…';
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) {
        await reg.update();
        if (reg.waiting) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); }
        // 新しい版が見つかれば controllerchange で自動的に再読み込みされる
        await new Promise((r) => setTimeout(r, 2500));
        if (reg.installing || reg.waiting) { location.reload(); return; }
      }
      location.reload();
    } catch (e) {
      alert('更新の確認に失敗しました。通信状態を確認してもう一度お試しください。');
      btn.disabled = false; btn.textContent = '更新を確認';
    }
  });
  renderHeader();
  fillForm(todayKey());
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // 新しいバージョンが有効になったら一度だけ再読み込みして、古いキャッシュと混ざらないようにする
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) location.reload();
      hadController = true;
    });
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
