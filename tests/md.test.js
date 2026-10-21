// 実行: node tests/md.test.js
// 依頼書 AN-001 の受入ケースを、合成の短いサンプルで確かめる。
const assert = require("assert");
const MD = require("../md.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     " + e.message); }
}
const R = (s, o) => MD.render(s, o || {});
const count = (h, re) => (h.match(re) || []).length;

t("連続する台詞は連結しない", () => {
  const r = R("「こんにちは」\n「おはよう」\n　地の文が続く。");
  assert.strictEqual(count(r.html, /data-kind="para"/g), 3);
  assert.ok(r.html.includes("　地の文が続く。"), "全角字下げが残る");
});

t("空行は残り、空行を詰めると消える", () => {
  assert.strictEqual(count(R("a\n\nb").html, /class="blank"/g), 1);
  assert.strictEqual(count(R("a\n\nb", { squash: true }).html, /class="blank"/g), 0);
});

t("見出し・強調・取消・水平線の記号が本文に出ない", () => {
  const r = R("# 第7話　新しい朝\n**太字**と*強調*と~~取消~~\n---");
  assert.ok(r.html.includes("<h1"));
  assert.ok(r.html.includes("<strong>太字</strong>"));
  assert.ok(r.html.includes("<em>強調</em>"));
  assert.ok(r.html.includes("<del>取消</del>"));
  assert.ok(r.html.includes('role="separator"'));
  assert.ok(!/[#*~]/.test(r.html.replace(/<[^>]+>/g, "")), "記号が残っていない");
});

t("リストの項目と順序が残る", () => {
  const r = R("1. 一\n2. 二\n   - 入れ子\n3. 三");
  assert.ok(r.html.includes("<ol>"));
  assert.ok(r.html.includes("<ul><li>入れ子"));
  assert.ok(r.html.indexOf("一") < r.html.indexOf("二") && r.html.indexOf("二") < r.html.indexOf("三"));
});

t("表はセル・列・行を欠落させない（列数不一致も保持）", () => {
  const r = R("| 項目 | 値 |\n|---|--:|\n| スピード | +10 |\n| 体力 | 5 | 余分 |");
  assert.strictEqual(count(r.html, /<td/g), 6);
  assert.ok(r.html.includes("余分"));
  assert.ok(r.html.includes("text-align:right"));
  assert.ok(r.html.includes("+10"));
});

t("System・判定・アンケートは本文として残る", () => {
  const src = "≪System≫\n成功／スピード＋10\n\n【アンケート】\n次は何を鍛える？\n## 次月への引き継ぎ\n残す";
  const r = R(src);
  ["≪System≫", "成功／スピード＋10", "【アンケート】", "次は何を鍛える？", "次月への引き継ぎ", "残す"].forEach(w =>
    assert.ok(r.html.includes(w), w + " が残る"));
  assert.strictEqual(r.internalCount, 0);
});

t("正しいマーカー1組：読書表示で隠し、全文表示で戻す", () => {
  const src = "本文\n<!-- agilnote:internal:start -->\n## GM向け\n秘密のメモ\n<!-- agilnote:internal:end -->\n【アンケート】";
  const a = R(src);
  assert.ok(!a.html.includes("秘密のメモ"));
  assert.ok(a.html.includes("【アンケート】"));
  assert.ok(a.html.includes("内部記録を非表示"));
  assert.strictEqual(a.internalCount, 1);
  const b = R(src, { view: "full" });
  assert.ok(b.html.includes("秘密のメモ"));
  assert.ok(b.html.includes('data-kind="internal"'));
  assert.deepStrictEqual(a.warnings, []);
});

t("終了がないマーカー：何も隠さず警告", () => {
  const r = R("<!-- agilnote:internal:start -->\nメモ\n【アンケート】\n選択肢A");
  assert.ok(r.html.includes("メモ") && r.html.includes("選択肢A"));
  assert.strictEqual(r.warnings.length, 1);
});

t("入れ子・逆順：何も隠さず警告", () => {
  const nest = R("<!-- agilnote:internal:start -->\nA\n<!-- agilnote:internal:start -->\nB\n<!-- agilnote:internal:end -->\n<!-- agilnote:internal:end -->");
  assert.ok(nest.html.includes("A") && nest.html.includes("B"));
  assert.ok(nest.warnings.length >= 1);
  const rev = R("<!-- agilnote:internal:end -->\nC\n<!-- agilnote:internal:start -->\nD");
  assert.ok(rev.html.includes("C") && rev.html.includes("D"));
  assert.ok(rev.warnings.length >= 2);
});

t("コードフェンス内・文中のマーカー文字列は境界にしない", () => {
  const r = R("```\n<!-- agilnote:internal:start -->\nコード\n<!-- agilnote:internal:end -->\n```\n文中の <!-- agilnote:internal:start --> は文字");
  assert.strictEqual(r.internalCount, 0);
  assert.ok(r.html.includes("コード"));
  assert.deepStrictEqual(r.warnings, []);
});

t("TXT ではない普通の HTML コメントは境界にしない", () => {
  const r = R("<!-- メモ -->\n<!--agilnote:internal:start-->\n本文");
  assert.strictEqual(r.internalCount, 0);
  assert.ok(r.html.includes("&lt;!-- メモ --&gt;"));
});

t("HTML・危険なリンクは実行されない", () => {
  const r = R('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[押す](javascript:alert(1))\n[安全](https://example.com)\n<a href="javascript:x">a</a>');
  assert.ok(!/<script|<img|<a [^>]*href="javascript|<[a-z][^>]* on[a-z]+=/i.test(r.html), "実行される要素がない");
  assert.ok(r.html.includes('href="https://example.com"'));
  assert.ok(r.html.includes("&lt;script&gt;"));
});

t("属性に入る文字も逃がす", () => {
  const r = R('[a](https://e.com/"onmouseover="x)');
  assert.ok(!/"onmouseover="/.test(r.html));
});

t("ルビ（｜・|・漢字）を維持", () => {
  const r = R("｜魔法《まほう》と|呪文《じゅもん》と漢字《かんじ》");
  assert.strictEqual(count(r.html, /<ruby>/g), 3);
});

t("コード内のルビ・強調は再解釈しない", () => {
  const r = R("`漢字《かんじ》 **太**`");
  assert.ok(!r.html.includes("<ruby>") && !r.html.includes("<strong>"));
});

t("縦書きの縦中横：本文のみ、コード・表・ルビの読みは対象外", () => {
  const r = R("第12話！？\n`12`\n|a|\n|-|\n|34|\n漢字《12》", { vertical: true });
  assert.ok(r.html.includes('<span class="tcy">12</span>'));
  assert.ok(r.html.includes('<span class="tcy">！？</span>'));
  assert.ok(r.html.includes("<code>12</code>"));
  assert.ok(r.html.includes("<td>34</td>"));
  assert.ok(r.html.includes("<rt>12</rt>"));
});

t("エスケープした記号は文字として出る", () => {
  const r = R("\\*星\\* と \\# 記号");
  assert.ok(r.html.includes("*星*") && !r.html.includes("<em>"));
});

t("場面区切り記号は区切りとして扱う", () => {
  assert.ok(R("　　　　　◇").html.includes('class="sep"'));
});

t("台詞中の * は勝手に強調にしない（閉じがない）", () => {
  const r = R("「5*3は？」");
  assert.ok(r.html.includes("5*3"));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
