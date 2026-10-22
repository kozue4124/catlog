/* 診療明細のテキスト(iPhone「テキストをスキャン」などで取り込んだ文字)から
   日付・病院名・合計金額・診療内容を取り出す。外部送信なし。 */
(function (root) {
  'use strict';

  const toHalf = (s) => s.normalize('NFKC').replace(/[　]/g, ' ');
  const numVal = (s) => { const n = Number(String(s).replace(/[,，¥￥円\s]/g, '')); return Number.isFinite(n) ? n : null; };
  const pad = (n) => String(n).padStart(2, '0');
  const ERA = { '令和': 2018, '平成': 1988, 'R': 2018, 'H': 1988 };

  function findDate(lines) {
    for (const l of lines) {
      let m = l.match(/(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/);
      if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
      m = l.match(/(令和|平成|R|H)\s*(\d{1,2})\s*[年.\/]\s*(\d{1,2})\s*[月.\/]\s*(\d{1,2})/);
      if (m) return `${ERA[m[1]] + Number(m[2])}-${pad(m[3])}-${pad(m[4])}`;
    }
    return null;
  }

  const DATE_RE = /(20\d{2}\s*[年\/\-.]\s*\d{1,2}\s*[月\/\-.]\s*\d{1,2}\s*日?|(令和|平成|R|H)\s*\d{1,2}\s*[年.\/]\s*\d{1,2}\s*[月.\/]\s*\d{1,2}\s*日?)/;
  const AMOUNT_RE = /(?:[¥￥]\s*)?(\d{1,3}(?:,\d{3})+|\d+)\s*(?:円)?/g;
  function amountsIn(line) {
    const out = [];
    for (const m of line.matchAll(AMOUNT_RE)) { const v = numVal(m[1]); if (v != null) out.push(v); }
    return out;
  }

  const TOTAL_KEYS = [
    /ご?入金額/, /お預り|お預かり/, /ご?請求額|請求金額/, /お支払|支払額|支払金額/, /領収金額|領収額/, /税込合計|合計\s*\(税込\)|合計金額/, /^合\s*計|合計/
  ];
  function findTotal(lines) {
    // 優先キーワード順に、その行(または直後の行)の金額を採用
    for (const key of TOTAL_KEYS) {
      for (let i = 0; i < lines.length; i++) {
        if (!key.test(lines[i]) || /対象額|税抜|税額|小計|外税|内税|預り.*釣|お釣/.test(lines[i])) continue;
        const here = amountsIn(lines[i].replace(/\d{1,2}%/g, ''));
        const vals = here.length ? here : (i + 1 < lines.length ? amountsIn(lines[i + 1]) : []);
        const pick = vals.filter((v) => v >= 10);
        if (pick.length) return pick[pick.length - 1];
      }
    }
    // ¥ 付きの最大値 → なければ全体の最大値
    let best = null;
    for (const l of lines) for (const m of l.matchAll(/[¥￥]\s*(\d{1,3}(?:,\d{3})+|\d+)/g)) { const v = numVal(m[1]); if (v != null && (best == null || v > best)) best = v; }
    if (best != null) return best;
    for (const l of lines) for (const v of amountsIn(l)) if (v >= 100 && (best == null || v > best)) best = v;
    return best;
  }

  const CLINIC_RE = /(どうぶつ病院|動物病院|動物医療|アニマル|ペットクリニック|クリニック|病院|獣医|動物診療|ホスピタル|ANIMAL|CLINIC|HOSPITAL)/i;
  function findClinic(lines) {
    const cands = lines.filter((l) => CLINIC_RE.test(l) && !/明細|領収|請求|診療時間|休診|様$|様\s/.test(l));
    if (!cands.length) return null;
    // 住所・電話を含まない短めの行を優先
    cands.sort((a, b) => a.length - b.length);
    return cands[0].replace(DATE_RE, '').replace(/^(病院名|医院名|発行)[:：]?\s*/, '').trim();
  }

  const SKIP_RE = /(小計|合計|総計|税額|外税|内税|消費税|対象額|税抜|税込|請求|入金|お預|お釣|領収|数量|単価|金額$|^金額|明細書|明細内容|^No\.?\d|Tel|TEL|電話|FAX|〒|県.*市|都.*区|市.*町|診療時間|休診|曜日|院長|お大事|様$|飼育者|飼い主|ペット名|ありがとう|[0-9]{1,2}:[0-9]{2}|^[0-9\-+]+$)/;
  const HEADER_RE = (l) => /明細内容|診療内容|項目|内容/.test(l) && /数量|単価|金額|料金/.test(l);
  const LETTERS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]/gu;

  function findItems(lines, clinic) {
    const hasHeader = lines.some(HEADER_RE);
    const items = [];
    let started = !hasHeader;
    for (let raw of lines) {
      let l = raw.trim();
      if (!l) continue;
      if (HEADER_RE(l)) { started = true; continue; }
      if (!started) continue;
      if (/^(小\s*計|合\s*計|総\s*計)/.test(l.replace(/\s/g, '')) ) break;
      if (clinic && l.includes(clinic)) continue;
      // 金額だけの行は、直前の項目に金額が無ければそれに充てる(列ごとに読まれた場合)
      if (/^[¥￥]?\s*[\d,]+\s*(円)?$/.test(l)) {
        const prev = items[items.length - 1];
        if (prev && prev.amount == null) prev.amount = numVal(l);
        continue;
      }
      // 行頭の日付(1行目の項目に付くことがある)を外す
      l = l.replace(DATE_RE, '').trim();
      if (!l) continue;
      // 【 (全1回) 】 のような注釈は飛ばす
      if (/^[【\[].*[】\]]$/.test(l) || /^[<＜].*[>＞]$/.test(l)) continue;
      const paren = /^[(（].*[)）]\s*$/.test(l);
      const body = paren ? l.replace(/^[(（]\s*/, '').replace(/\s*[)）]\s*$/, '') : l;
      if (SKIP_RE.test(body.replace(/\s/g, '')) && !paren) continue;
      if (/^(令和|平成|R\d|H\d)/.test(body)) continue;
      if (/^[¥￥]?\s*[\d,]+\s*(円)?$/.test(body)) continue; // 数字だけの行
      // 「名前 数量 単価 金額」 / 「名前 金額」
      let m = body.match(/^(.*?[^\d,\s])\s+(\d{1,3})\s+([\d,]+)\s+([\d,]+)$/);
      let name, amount;
      if (m) { name = m[1]; amount = numVal(m[4]); }
      else {
        m = body.match(/^(.*?[^\d,\s])\s+[¥￥]?\s*([\d,]+)\s*(円)?$/);
        if (m) { name = m[1]; amount = numVal(m[2]); }
        else if (/[^\d\s,.¥￥()（）\-]/.test(body) && body.length <= 40) { name = body; amount = null; }
        else continue;
      }
      name = name.replace(/\s+/g, ' ').trim();
      if (!name || (name.match(LETTERS) || []).length < 2) continue;
      if (paren) {
        // 括弧行は直前の項目の補足として名前にまとめる(金額が同じなら二重計上しない)
        const prev = items[items.length - 1];
        if (prev) { prev.name = `${prev.name}(${name})`; if (prev.amount == null) prev.amount = amount; continue; }
      }
      items.push({ name, amount });
    }
    return items;
  }

  function parseReceiptText(text) {
    const lines = toHalf(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const date = findDate(lines);
    const total = findTotal(lines);
    const clinic = findClinic(lines);
    const items = findItems(lines, clinic);
    return { date, total, clinic, items };
  }

  root.parseReceiptText = parseReceiptText;
  if (typeof module !== 'undefined' && module.exports) module.exports = parseReceiptText;
})(typeof window !== 'undefined' ? window : globalThis);
