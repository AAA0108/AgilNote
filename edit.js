/*
 * AgilNote 編集モードの下回り（画面に依存しない部分）
 *
 * - 原文と編集後の本文を比べ、色を付ける範囲を返す（行＝段落ごと、その中は文字ごと）
 * - 本文を Shift_JIS のバイト列に戻す（ブラウザ標準の TextEncoder は UTF-8 しか書けないため）
 *
 * 位置はすべて「編集後の本文（行を \n でつないだ文字列）」の中の文字位置（UTF-16 単位）。
 */
(function (root) {
  "use strict";

  /* 比べる量の上限。これを超える塊は、まとめて「書き換えた」として扱う（固まらないように） */
  var LIMIT = 4000000;

  /**
   * 2 つの並び（文字列の配列、または文字列）の差分を、
   * "e"（同じ）・"d"（原文から消えた）・"i"（新しく入った）の並びで返す。
   */
  function ops(a, b) {
    var n = a.length, m = b.length, p = 0, s = 0;
    while (p < n && p < m && a[p] === b[p]) p++;
    while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) s++;
    var out = [], i, j;
    for (i = 0; i < p; i++) out.push("e");
    var an = n - p - s, bm = m - p - s;
    if (an === 0 || bm === 0 || an * bm > LIMIT) {
      for (i = 0; i < an; i++) out.push("d");
      for (j = 0; j < bm; j++) out.push("i");
    } else {
      // 最長共通部分列（後ろから表を埋め、前から辿る）
      var W = bm + 1, dp = new Uint32Array((an + 1) * W);
      for (i = an - 1; i >= 0; i--) {
        for (j = bm - 1; j >= 0; j--) {
          dp[i * W + j] = a[p + i] === b[p + j]
            ? dp[(i + 1) * W + j + 1] + 1
            : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
        }
      }
      i = 0; j = 0;
      while (i < an && j < bm) {
        if (a[p + i] === b[p + j]) { out.push("e"); i++; j++; }
        else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { out.push("d"); i++; }
        else { out.push("i"); j++; }
      }
      while (i < an) { out.push("d"); i++; }
      while (j < bm) { out.push("i"); j++; }
    }
    for (i = 0; i < s; i++) out.push("e");
    return out;
  }

  /* 1 行の中の文字の差分 → 足した範囲（行頭からの位置）と、消した位置 */
  function charMarks(a, b) {
    var o = ops(a, b), ai = 0, bi = 0, adds = [], dels = [], k;
    for (k = 0; k < o.length; k++) {
      if (o[k] === "e") { ai++; bi++; }
      else if (o[k] === "d") {
        if (!dels.length || dels[dels.length - 1] !== bi) dels.push(bi);
        ai++;
      } else {
        var last = adds[adds.length - 1];
        if (last && last[1] === bi) last[1] = bi + 1; else adds.push([bi, bi + 1]);
        bi++;
      }
    }
    return { adds: adds, dels: dels };
  }

  /**
   * marks(原文の行配列, 編集後の行配列)
   * → { line: [[始,終]...]  書き換えた段落（薄い色）
   *     add:  [[始,終]...]  足した文字（濃い色）
   *     del:  [位置...]     消した場所
   *     changes: 変更か所の数 }
   */
  function marks(base, cur) {
    var starts = [], pos = 0, k;
    for (k = 0; k < cur.length; k++) { starts.push(pos); pos += cur[k].length + 1; }
    var lineEnd = function (li) { return starts[li] + cur[li].length; };
    var res = { line: [], add: [], del: [], changes: 0 };
    var o = ops(base, cur), ai = 0, bi = 0, dl = [], il = [];

    function flush() {
      if (!dl.length && !il.length) return;
      res.changes++;
      var pairs = Math.min(dl.length, il.length), t;
      for (t = 0; t < pairs; t++) {
        var li = il[t], st = starts[li], cm = charMarks(base[dl[t]], cur[li]);
        if (cur[li].length) res.line.push([st, lineEnd(li)]);
        cm.adds.forEach(function (r) { res.add.push([st + r[0], st + r[1]]); });
        cm.dels.forEach(function (p) { res.del.push(st + p); });
      }
      for (t = pairs; t < il.length; t++) {
        var l2 = il[t];
        if (cur[l2].length) { res.line.push([starts[l2], lineEnd(l2)]); res.add.push([starts[l2], lineEnd(l2)]); }
      }
      if (dl.length > il.length) {
        // 段落ごと消えた：直前の段落の終わり、なければ次の段落の頭に印
        if (pairs > 0) res.del.push(lineEnd(il[pairs - 1]));
        else res.del.push(bi < cur.length ? starts[bi] : (cur.length ? lineEnd(cur.length - 1) : 0));
      }
      dl = []; il = [];
    }

    for (k = 0; k < o.length; k++) {
      if (o[k] === "e") { flush(); ai++; bi++; }
      else if (o[k] === "d") { dl.push(ai); ai++; }
      else { il.push(bi); bi++; }
    }
    flush();
    return res;
  }

  /* 消した位置を、見える 1 文字の範囲に直す（改行の上には印を付けられないため） */
  function delSpot(text, p) {
    if (p < text.length && text[p] !== "\n") return [p, p + 1];
    if (p > 0 && text[p - 1] !== "\n") return [p - 1, p];
    return null;
  }

  /* ---------- Shift_JIS（Windows-31J）への書き出し ---------- */

  var sjisTable = null;
  function buildSjis() {
    var dec = new TextDecoder("shift_jis"), map = new Map(), lead, trail, buf = new Uint8Array(2);
    for (var c = 0; c < 0x80; c++) map.set(String.fromCharCode(c), [c]);
    for (c = 0xA1; c <= 0xDF; c++) map.set(String.fromCharCode(0xFF61 + c - 0xA1), [c]);
    for (lead = 0x81; lead <= 0xFC; lead++) {
      if (lead > 0x9F && lead < 0xE0) continue;
      for (trail = 0x40; trail <= 0xFC; trail++) {
        if (trail === 0x7F) continue;
        var pointer = (lead - (lead < 0xA0 ? 0x81 : 0xC1)) * 188 + trail - (trail < 0x7F ? 0x40 : 0x41);
        if (pointer >= 8272 && pointer <= 8835) continue; // 重複する IBM 拡張の別位置は使わない（WHATWG と同じ）
        buf[0] = lead; buf[1] = trail;
        var ch = dec.decode(buf);
        if (ch.length === 1 && ch !== "�" && !map.has(ch)) map.set(ch, [lead, trail]);
      }
    }
    map.set("¥", [0x5C]); map.set("‾", [0x7E]);
    // JIS と Windows-31J で別の文字になる記号は、見た目が同じ文字として書く
    // 〜→～　−→－　‖→∥　—→―　¢→￠　£→￡　¬→￢
    [["〜", "～"], ["−", "－"], ["‖", "∥"], ["—", "―"],
     ["¢", "￠"], ["£", "￡"], ["¬", "￢"]].forEach(function (p) {
      if (!map.has(p[0]) && map.has(p[1])) map.set(p[0], map.get(p[1]));
    });
    return map;
  }

  /** encodeSjis(文字列) → { bytes: Uint8Array, bad: [書けない文字（重複なし）] } */
  function encodeSjis(str) {
    if (!sjisTable) sjisTable = buildSjis();
    var out = [], bad = [], seen = {};
    for (var ch of str) {
      var b = sjisTable.get(ch);
      if (b) { out.push(b[0]); if (b.length > 1) out.push(b[1]); }
      else if (!seen[ch]) { seen[ch] = 1; bad.push(ch); }
    }
    return { bytes: new Uint8Array(out), bad: bad };
  }

  var api = { ops: ops, marks: marks, charMarks: charMarks, delSpot: delSpot, encodeSjis: encodeSjis };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgilEdit = api;
})(typeof self !== "undefined" ? self : this);
