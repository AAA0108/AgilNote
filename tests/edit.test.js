// 実行: node tests/edit.test.js
// 編集モードの差分（色を付ける範囲）と Shift_JIS 書き出しを確かめる。
const assert = require("assert");
const E = require("../edit.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n     " + e.message); }
}
const L = s => s.split("\n");
const pick = (text, rs) => rs.map(r => text.slice(r[0], r[1]));

t("同じなら印は何もない", () => {
  const m = E.marks(L("a\nb"), L("a\nb"));
  assert.deepStrictEqual(m, { line: [], add: [], del: [], changes: 0 });
});

t("段落の中で足した文字だけが濃い色になる", () => {
  const cur = "一行目\n　彼女は静かに笑った。\n三行目";
  const m = E.marks(L("一行目\n　彼女は笑った。\n三行目"), L(cur));
  assert.strictEqual(m.changes, 1);
  assert.deepStrictEqual(pick(cur, m.line), ["　彼女は静かに笑った。"]);
  assert.deepStrictEqual(pick(cur, m.add), ["静かに"]);
  assert.deepStrictEqual(m.del, []);
});

t("消した文字は位置だけ残る", () => {
  const cur = "　彼女は笑った。";
  const m = E.marks(L("　彼女は静かに笑った。"), L(cur));
  assert.deepStrictEqual(m.add, []);
  assert.deepStrictEqual(m.del, [4]);
  assert.deepStrictEqual(E.delSpot(cur, 4), [4, 5]);
});

t("新しく足した段落は丸ごと濃い色", () => {
  const cur = "a\n新しい段落\nb";
  const m = E.marks(L("a\nb"), L(cur));
  assert.deepStrictEqual(pick(cur, m.add), ["新しい段落"]);
  assert.strictEqual(m.changes, 1);
});

t("段落ごと消すと前後に印が付く", () => {
  const cur = "a\nb";
  const m = E.marks(L("a\n消える段落\nb"), L(cur));
  assert.strictEqual(m.changes, 1);
  assert.strictEqual(m.del.length, 1);
  assert.ok(E.delSpot(cur, m.del[0]), "見える文字に印を置ける");
});

t("離れた 2 か所の変更は 2 か所と数える", () => {
  const base = Array.from({ length: 50 }, (_, i) => "段落" + i);
  const cur = base.slice(); cur[3] = "段落三"; cur[40] = "段落40改";
  const m = E.marks(base, cur);
  assert.strictEqual(m.changes, 2);
  assert.deepStrictEqual(pick(cur.join("\n"), m.add), ["三", "改"]);
});

t("空行を足しても色の範囲は空にならない", () => {
  const m = E.marks(L("a\nb"), L("a\n\nb"));
  assert.strictEqual(m.changes, 1);
  assert.deepStrictEqual(m.add, []);
});

t("長い本文でも途中の変更だけを拾う", () => {
  const base = Array.from({ length: 20000 }, (_, i) => "　地の文の段落その" + i + "。");
  const cur = base.slice(); cur[10000] = "「台詞に変えた」";
  const t0 = Date.now(); const m = E.marks(base, cur);
  assert.strictEqual(m.changes, 1);
  assert.ok(Date.now() - t0 < 500, "速さ");
});

t("Shift_JIS：もとのバイト列に戻る", () => {
  const src = "アビドス高等学校の対策委員会室①　ｶﾀｶﾅ ~\\ 髙﨑 ―～∥－";
  const r = E.encodeSjis(src);
  assert.deepStrictEqual(r.bad, []);
  assert.strictEqual(new TextDecoder("shift_jis").decode(r.bytes), src);
});

t("Shift_JIS：波ダッシュなどは見た目が同じ文字で書く", () => {
  const r = E.encodeSjis("〜−‖—");
  assert.deepStrictEqual(r.bad, []);
  assert.strictEqual(new TextDecoder("shift_jis").decode(r.bytes), "～－∥―");
});

t("Shift_JIS：書けない文字を知らせる", () => {
  const r = E.encodeSjis("好き♡🙂です♡");
  assert.deepStrictEqual(r.bad, ["♡", "🙂"]);
});

t("Shift_JIS：改行コードはそのまま", () => {
  const r = E.encodeSjis("あ\r\nい\n");
  assert.deepStrictEqual(Array.from(r.bytes.slice(2, 4)), [0x0D, 0x0A]);
});

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
