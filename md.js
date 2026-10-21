/*
 * AgilNote Markdown 描画（小説向け）
 *
 * 一般的な Markdown と違い、本文の 1 行を 1 段落として扱う（台詞を連結しない）。
 * 入力の HTML は実行せず、すべて文字として表示する。元の文字列は変更しない。
 *
 * 内部記録の境界（単独行・完全一致、コードフェンスの外のみ）:
 *   <!-- agilnote:internal:start -->
 *   <!-- agilnote:internal:end -->
 * 開始と終了が正しく対応しない場合は何も隠さず、警告を返す。
 */
(function (root) {
  "use strict";

  var MARK_START = "<!-- agilnote:internal:start -->";
  var MARK_END = "<!-- agilnote:internal:end -->";

  function esc(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- 行内 ---------- */

  var ASCII_PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
  var PH = ""; // エスケープ文字の置き場所（ルビ・縦中横の対象外にする）

  // 平文の葉：エスケープ → ルビ → 縦中横
  function leaf(text, ctx) {
    var h = esc(text);
    h = h.replace(/[|｜]([^|｜《》\n]+?)《([^》\n]+?)》/g, "<ruby>$1<rt>$2</rt></ruby>");
    h = h.replace(/([一-龠々ヶ]+)《([^》\n]+?)》/g, "<ruby>$1<rt>$2</rt></ruby>");
    if (ctx.vertical) {
      // ルビの読み（rt）の中には縦中横をかけない
      h = h.replace(/(<rt>[\s\S]*?<\/rt>)|(^|[^0-9０-９!?！？])([0-9]{2}|[!?！？]{2})(?![0-9!?！？])/g,
        function (m, rt, pre, body) { return rt ? rt : pre + '<span class="tcy">' + body + "</span>"; });
    }
    h = h.replace(new RegExp(PH + "([\\s\\S])", "g"), function (m, ch) {
      return esc(String.fromCharCode(ch.charCodeAt(0) - 0xE100));
    });
    return h;
  }

  function safeUrl(u) {
    var t = u.trim().replace(/^<|>$/g, "");
    if (/^(https?:|mailto:)/i.test(t)) return t;
    return null;
  }

  // 次の同じ長さのバッククォート列を探す
  function findBackticks(s, from, n) {
    var i = from;
    while (i < s.length) {
      var j = s.indexOf("`", i);
      if (j < 0) return -1;
      var k = j;
      while (k < s.length && s[k] === "`") k++;
      if (k - j === n) return j;
      i = k;
    }
    return -1;
  }

  function isSpace(c) { return c === undefined || /\s/.test(c); }
  function isAlnum(c) { return c !== undefined && /[A-Za-z0-9]/.test(c); }

  // 強調の閉じ記号を探す（コードスパンとエスケープは飛ばす）
  function findCloser(s, from, ch, n) {
    var i = from;
    while (i < s.length) {
      var c = s[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") {
        var r = i; while (r < s.length && s[r] === "`") r++;
        var close = findBackticks(s, r, r - i);
        i = close < 0 ? r : close + (r - i);
        continue;
      }
      if (c === ch) {
        var e = i; while (e < s.length && s[e] === ch) e++;
        var run = e - i;
        if (run >= n && !isSpace(s[i - 1]) && i > from && !(ch === "_" && isAlnum(s[i + n]))) {
          return i + (run - n); // 長い列なら末尾側で閉じる
        }
        i = e;
        continue;
      }
      i++;
    }
    return -1;
  }

  function inline(s, ctx) {
    var out = "", buf = "", i = 0;
    function flush() { if (buf) { out += leaf(buf, ctx); buf = ""; } }

    while (i < s.length) {
      var c = s[i];

      if (c === "\\" && i + 1 < s.length && ASCII_PUNCT.indexOf(s[i + 1]) >= 0) {
        buf += PH + String.fromCharCode(s.charCodeAt(i + 1) + 0xE100);
        i += 2; continue;
      }

      if (c === "`") {
        var r = i; while (r < s.length && s[r] === "`") r++;
        var n = r - i, close = findBackticks(s, r, n);
        if (close >= 0) {
          var code = s.slice(r, close);
          if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
          flush(); out += "<code>" + esc(code) + "</code>";
          i = close + n; continue;
        }
        buf += s.slice(i, r); i = r; continue;
      }

      if (c === "!" && s[i + 1] === "[") {
        var img = parseLink(s, i + 1);
        if (img) {
          flush();
          var src = safeUrl(img.url);
          var label = "［画像：" + (img.text || "無題") + "］";
          out += src ? '<a class="md-img" href="' + esc(src) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>"
                     : '<span class="md-img">' + esc(label) + "</span>";
          i = img.end; continue;
        }
      }

      if (c === "[") {
        var lk = parseLink(s, i);
        if (lk) {
          flush();
          var href = safeUrl(lk.url);
          var inner = inline(lk.text, ctx);
          out += href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + inner + "</a>"
                      : '<span class="md-badlink" title="' + esc("開かないリンク：" + lk.url) + '">' + inner + "</span>";
          i = lk.end; continue;
        }
      }

      if (c === "<") {
        var m = /^<(https?:\/\/[^\s<>]+)>/i.exec(s.slice(i));
        if (m) {
          flush();
          out += '<a href="' + esc(m[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(m[1]) + "</a>";
          i += m[0].length; continue;
        }
      }

      if (c === "*" || c === "_" || (c === "~" && s[i + 1] === "~")) {
        var e = i; while (e < s.length && s[e] === c) e++;
        var run = e - i;
        var opensOk = !isSpace(s[e]) && !(c === "_" && isAlnum(s[i - 1]));
        if (opensOk) {
          var tries = c === "~" ? [2] : (run >= 3 ? [3, 2, 1] : run === 2 ? [2, 1] : [1]);
          var done = false;
          for (var t = 0; t < tries.length && !done; t++) {
            var k = tries[t];
            var start = i + k;
            var cl = findCloser(s, start, c, k);
            if (cl > start) {
              var body = inline(s.slice(start, cl), ctx);
              flush();
              if (c === "~") out += "<del>" + body + "</del>";
              else if (k === 3) out += "<strong><em>" + body + "</em></strong>";
              else if (k === 2) out += "<strong>" + body + "</strong>";
              else out += "<em>" + body + "</em>";
              i = cl + k; done = true;
            }
          }
          if (done) continue;
        }
        buf += s.slice(i, e); i = e; continue;
      }

      buf += c; i++;
    }
    flush();
    return out;
  }

  // [文字](URL "題") を読む。読めなければ null
  function parseLink(s, i) {
    if (s[i] !== "[") return null;
    var depth = 0, j = i;
    for (; j < s.length; j++) {
      if (s[j] === "\\") { j++; continue; }
      if (s[j] === "[") depth++;
      else if (s[j] === "]") { depth--; if (depth === 0) break; }
    }
    if (j >= s.length || s[j + 1] !== "(") return null;
    var k = j + 2, pd = 1;
    for (; k < s.length; k++) {
      if (s[k] === "\\") { k++; continue; }
      if (s[k] === "(") pd++;
      else if (s[k] === ")") { pd--; if (pd === 0) break; }
    }
    if (k >= s.length) return null;
    var dest = s.slice(j + 2, k).trim();
    var url = dest.replace(/\s+(".*"|'.*')$/, "");
    if (!url || /\s/.test(url.replace(/^<.*>$/, "x"))) return null;
    return { text: s.slice(i + 1, j), url: url, end: k + 1 };
  }

  /* ---------- ブロック ---------- */

  var RE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  var RE_HEAD = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
  var RE_HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var RE_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
  var RE_QUOTE = /^ {0,3}>/;
  var RE_DELIM = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
  var RE_SEP = /^[\s　]*[◇◆＊*※☆★●○■□]+[\s　]*$/;

  function indentOf(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      if (s[i] === " ") n++; else if (s[i] === "\t") n += 4; else break;
    }
    return n;
  }

  function isBlank(l) { return !l.replace(/[\s　]/g, ""); }
  function isMarker(l, m) { return l.trim() === m; }

  // 表のセル分割（\| とコードスパン内の | では分けない）
  function splitRow(line) {
    var s = line.trim();
    if (s[0] === "|") s = s.slice(1);
    if (s[s.length - 1] === "|" && s[s.length - 2] !== "\\") s = s.slice(0, -1);
    var cells = [], cur = "", i = 0;
    while (i < s.length) {
      var c = s[i];
      if (c === "\\" && s[i + 1] === "|") { cur += "\\|"; i += 2; continue; }
      if (c === "`") {
        var r = i; while (r < s.length && s[r] === "`") r++;
        var close = findBackticks(s, r, r - i);
        if (close >= 0) { cur += s.slice(i, close + (r - i)); i = close + (r - i); continue; }
        cur += s.slice(i, r); i = r; continue;
      }
      if (c === "|") { cells.push(cur.trim()); cur = ""; i++; continue; }
      cur += c; i++;
    }
    cells.push(cur.trim());
    return cells;
  }

  // 内部記録マーカーの対応を検査する（トップレベル、フェンス外のみ）
  function scanMarkers(lines) {
    var fence = null, open = -1, pairs = [], problems = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], f = RE_FENCE.exec(l);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
        continue;
      }
      if (f && !(f[1][0] === "`" && f[2].indexOf("`") >= 0)) { fence = f[1]; continue; }
      if (isMarker(l, MARK_START)) {
        if (open >= 0) problems.push((i + 1) + "行目：前の開始（" + (open + 1) + "行目）が閉じる前に、もう一つ開始がある");
        else open = i;
      } else if (isMarker(l, MARK_END)) {
        if (open < 0) problems.push((i + 1) + "行目：対応する開始がない終了");
        else { pairs.push([open, i]); open = -1; }
      }
    }
    if (open >= 0) problems.push((open + 1) + "行目：開始に対応する終了がない");
    return problems.length ? { ok: false, pairs: [], problems: problems } : { ok: true, pairs: pairs, problems: [] };
  }

  // lines を描画して HTML 断片の配列を返す
  function blocks(lines, ctx, top) {
    var out = [], i = 0;
    var vctx = ctx, hctx = { vertical: false };

    while (i < lines.length) {
      var l = lines[i];

      // 内部記録
      if (top && ctx.pairStart && ctx.pairStart[i] !== undefined) {
        var endAt = ctx.pairStart[i];
        var inner = lines.slice(i + 1, endAt);
        var chars = 0;
        ctx.internal.count++;
        if (ctx.view === "full") {
          var sub = blocks(inner, { vertical: ctx.vertical, squash: ctx.squash, view: ctx.view, internal: ctx.internal }, false);
          out.push('<section class="internal" data-kind="internal"><p class="internal-label">内部記録（読書表示では非表示）</p>' + sub.join("") + "</section>");
        } else {
          out.push('<p class="internal-note" data-kind="note">内部記録を非表示</p>');
        }
        inner.forEach(function (x) { chars += x.replace(/[\s　]/g, "").length; });
        ctx.internal.chars += chars;
        i = endAt + 1; continue;
      }

      if (isBlank(l)) {
        if (!ctx.squash) out.push('<p class="blank" data-kind="blank"></p>');
        i++; continue;
      }

      // コードフェンス
      var f = RE_FENCE.exec(l);
      if (f && !(f[1][0] === "`" && f[2].indexOf("`") >= 0)) {
        var body = [], j = i + 1;
        for (; j < lines.length; j++) {
          var g = RE_FENCE.exec(lines[j]);
          if (g && g[1][0] === f[1][0] && g[1].length >= f[1].length && !g[2].trim()) break;
          body.push(lines[j]);
        }
        out.push('<div class="hblock" data-kind="code"><pre><code>' + esc(body.join("\n")) + "</code></pre></div>");
        i = j + 1; continue;
      }

      // 見出し
      var h = RE_HEAD.exec(l);
      if (h) {
        var lv = h[1].length;
        out.push("<h" + lv + ' class="md-h" data-kind="heading">' + inline(h[2] || "", vctx) + "</h" + lv + ">");
        i++; continue;
      }

      // 水平線（場面転換）
      if (RE_HR.test(l)) {
        out.push('<div class="hr" role="separator" data-kind="sep"><span></span></div>');
        i++; continue;
      }

      // 表
      if (l.indexOf("|") >= 0 && i + 1 < lines.length && RE_DELIM.test(lines[i + 1]) && lines[i + 1].indexOf("-") >= 0) {
        var head = splitRow(l);
        var aligns = splitRow(lines[i + 1]).map(function (d) {
          d = d.trim();
          return d[0] === ":" && d[d.length - 1] === ":" ? "center" : d[d.length - 1] === ":" ? "right" : d[0] === ":" ? "left" : "";
        });
        var rows = [], k = i + 2;
        for (; k < lines.length; k++) {
          if (isBlank(lines[k]) || lines[k].indexOf("|") < 0) break;
          if (top && ctx.pairStart && ctx.pairStart[k] !== undefined) break;
          rows.push(splitRow(lines[k]));
        }
        // 列数が合わない行も、セルを捨てずに最大列数へそろえる
        var cols = Math.max(head.length, aligns.length);
        rows.forEach(function (r) { cols = Math.max(cols, r.length); });
        function cell(tag, txt, c) {
          var a = aligns[c] ? ' style="text-align:' + aligns[c] + '"' : "";
          return "<" + tag + a + ">" + inline(txt || "", hctx) + "</" + tag + ">";
        }
        var html = '<div class="hblock" data-kind="table"><table><thead><tr>';
        for (var c = 0; c < cols; c++) html += cell("th", head[c], c);
        html += "</tr></thead><tbody>";
        rows.forEach(function (r) {
          html += "<tr>";
          for (var c2 = 0; c2 < cols; c2++) html += cell("td", r[c2], c2);
          html += "</tr>";
        });
        out.push(html + "</tbody></table></div>");
        i = k; continue;
      }

      // 引用
      if (RE_QUOTE.test(l)) {
        var q = [], m = i;
        for (; m < lines.length && RE_QUOTE.test(lines[m]); m++) q.push(lines[m].replace(/^ {0,3}> ?/, ""));
        out.push('<blockquote data-kind="quote">' + blocks(q, { vertical: ctx.vertical, squash: true, view: ctx.view, internal: ctx.internal }, false).join("") + "</blockquote>");
        i = m; continue;
      }

      // リスト
      if (RE_ITEM.test(l)) {
        var res = list(lines, i, vctx);
        out.push(res.html);
        i = res.end; continue;
      }

      // 本文：1 行 1 段落
      var cls = RE_SEP.test(l) ? "sep" : "";
      out.push("<p" + (cls ? ' class="sep" data-kind="sep"' : ' data-kind="para"') + ">" + inline(l, vctx) + "</p>");
      i++;
    }
    return out;
  }

  function list(lines, i, ctx) {
    var html = "", stack = []; // {indent, tag}
    var j = i;
    for (; j < lines.length; j++) {
      var l = lines[j];
      if (isBlank(l)) break;
      var m = RE_ITEM.exec(l);
      if (!m) {
        if (stack.length && indentOf(l) >= 2) { html += "<br>" + inline(l.replace(/^[ \t]+/, ""), ctx); continue; }
        break;
      }
      if (RE_HR.test(l) && !stack.length) break;
      var ind = indentOf(m[1]);
      var ordered = /\d/.test(m[2]);
      var tag = ordered ? "ol" : "ul";
      while (stack.length && ind < stack[stack.length - 1].indent) {
        html += "</li></" + stack.pop().tag + ">";
      }
      var top = stack[stack.length - 1];
      if (!top || ind > top.indent) {
        var start = ordered && parseInt(m[2], 10) !== 1 ? ' start="' + parseInt(m[2], 10) + '"' : "";
        html += "<" + tag + start + ">";
        stack.push({ indent: ind, tag: tag });
      } else {
        html += "</li>";
        if (top.tag !== tag) {
          html += "</" + top.tag + "><" + tag + ">";
          top.tag = tag;
        }
      }
      html += "<li>" + inline(m[3], ctx);
    }
    while (stack.length) html += "</li></" + stack.pop().tag + ">";
    return { html: '<div class="md-list" data-kind="list">' + html + "</div>", end: j };
  }

  /**
   * render(text, {vertical, squash, view: "reading"|"full"})
   * → { html, warnings[], internalCount, internalChars }
   */
  function render(text, opts) {
    opts = opts || {};
    var lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    var scan = scanMarkers(lines);
    var pairStart = {};
    scan.pairs.forEach(function (p) { pairStart[p[0]] = p[1]; });
    var ctx = {
      vertical: !!opts.vertical, squash: !!opts.squash, view: opts.view === "full" ? "full" : "reading",
      pairStart: scan.ok ? pairStart : null, internal: { count: 0, chars: 0 }
    };
    var html = blocks(lines, ctx, true).join("");
    return {
      html: html,
      warnings: scan.problems,
      internalCount: ctx.internal.count,
      internalChars: ctx.internal.chars
    };
  }

  var api = { render: render, inline: function (s, o) { return inline(s, o || {}); }, MARK_START: MARK_START, MARK_END: MARK_END };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgilMD = api;
})(typeof self !== "undefined" ? self : this);
