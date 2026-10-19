/* ねこログ – 猫の飲水量・尿量を毎日記録する */
(() => {
  'use strict';

  const APP_VERSION = '1.1.1';
  const STORAGE_KEY = 'catlog.v1';
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
        return { settings: { ...defaultSettings(), ...(parsed.settings || {}) }, entries: parsed.entries || {} };
      }
    } catch (e) { console.warn('load failed', e); }
    return { settings: defaultSettings(), entries: {} };
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
    else hint.textContent = `${longDate(k)} に水とシートをセットし、翌日の同じ時刻に計測した結果を入れてください。`;
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
          <span class="h-water${w == null ? ' is-missing' : ''}">${w == null ? '未入力' : fmt(w) + ' ml'}</span>
          <span class="h-urine${u == null ? ' is-missing' : ''}">${u == null ? '未入力' : fmt(u, 1) + ' ml'}</span>
        </div>
        <div class="h-poop">${pt ? 'うんち ' + pt : '<span class="is-missing">うんち 未記録</span>'}</div>
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
      ? `<div class="kpi kpi-wide"><div class="kpi-label"><span class="dot dot-poop"></span>うんち(${chartRange}日間)</div>
          <div class="kpi-value">${poopDays}<small>日 / 記録${recorded.length}日</small>
          <small>朝 ${slotCount('morning')} ・ 昼 ${slotCount('noon')} ・ 夜 ${slotCount('night')} 回</small></div></div>`
      : '';
    $('#kpiRow').innerHTML = poopKpi + `
      <div class="kpi"><div class="kpi-label"><span class="dot dot-water"></span>飲水 直近7日平均</div>
        <div class="kpi-value">${fmt(w7)}<small>ml/日</small></div><div class="kpi-sub">${perKg(w7) || '&nbsp;'}</div></div>
      <div class="kpi"><div class="kpi-label"><span class="dot dot-urine"></span>尿 直近7日平均</div>
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
  }
  $('#settingsForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    state.settings = {
      catName: S.catName.value.trim(),
      catWeightKg: num(S.catWeight.value),
      defaultWaterMl: num(S.defaultWater.value),
      sheetDryG: num(S.sheetDry.value),
      evapMl: num(S.evap.value)
    };
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
  $('#exportJsonBtn').addEventListener('click', () => {
    download(`catlog-backup-${todayKey()}.json`, JSON.stringify({ app: 'catlog', version: APP_VERSION, exportedAt: new Date().toISOString(), ...state }, null, 2), 'application/json');
  });
  $('#importFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data.entries !== 'object') throw new Error('形式が違います');
      const n = Object.keys(data.entries).length;
      const mode = confirm(`${n}日分の記録が見つかりました。\n「OK」= 今あるデータに追加・上書き(マージ)\n「キャンセル」= 読み込まない`);
      if (!mode) return;
      state.entries = { ...state.entries, ...data.entries };
      if (data.settings) state.settings = { ...state.settings, ...data.settings };
      save(); renderHeader(); fillSettings(); alert('読み込みました。');
    } catch (e) { alert('読み込めませんでした: ' + e.message); }
  });
  $('#wipeBtn').addEventListener('click', () => {
    if (!confirm('すべての記録と設定を削除します。元に戻せません。よろしいですか?')) return;
    if (!confirm('本当に削除しますか?(先にバックアップをおすすめします)')) return;
    state = { settings: defaultSettings(), entries: {} };
    save(); renderHeader(); fillSettings(); fillForm(todayKey()); alert('削除しました。');
  });

  // ---------- init ----------
  $('#appVersion').textContent = APP_VERSION;
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
