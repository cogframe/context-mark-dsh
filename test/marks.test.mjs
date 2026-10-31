import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

let client;
const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
runInNewContext(source, {
  window: {
    __ModuleLoader__: {
      load(definition) { client = definition.factory(); }
    }
  }
});

const { applyMark, activeSessionId, normalizeSettings } = client.__test;
const plain = value => JSON.parse(JSON.stringify(value));

test("covering the middle removes the entire old mark", () => {
  const green = {
    id: "first", sourceKey: "reply-1", labelId: "exact",
    segments: [{ start: 0, end: 12 }], note: "这句话我已经会讲"
  };
  const red = {
    id: "second", sourceKey: "reply-1", labelId: "remove",
    segments: [{ start: 4, end: 7 }], note: ""
  };
  const result = applyMark([green], red);
  assert.deepEqual(plain(result), [red]);
});

test("covering from either side trims only that edge and keeps the old note", () => {
  const old = { id: "old", sourceKey: "reply-1", segments: [{ start: 4, end: 16 }], note: "原备注" };
  const fromLeft = { id: "left", sourceKey: "reply-1", segments: [{ start: 0, end: 8 }] };
  const leftResult = applyMark([old], fromLeft);
  assert.deepEqual(plain(leftResult[0].segments), [{ start: 8, end: 16 }]);
  assert.equal(leftResult[0].note, "原备注");
  assert.deepEqual(plain(leftResult[1]), fromLeft);

  const fromRight = { id: "right", sourceKey: "reply-1", segments: [{ start: 12, end: 20 }] };
  const rightResult = applyMark([old], fromRight);
  assert.deepEqual(plain(rightResult[0].segments), [{ start: 4, end: 12 }]);
  assert.equal(rightResult[0].note, "原备注");
  assert.deepEqual(plain(rightResult[1]), fromRight);
});

test("covering an entire old mark removes it without shortening the new mark", () => {
  const old = { id: "old", sourceKey: "reply-1", segments: [{ start: 4, end: 10 }] };
  const next = { id: "next", sourceKey: "reply-1", segments: [{ start: 2, end: 12 }] };
  assert.deepEqual(plain(applyMark([old], next)), [next]);
});

test("a new mark never changes marks on another reply", () => {
  const first = { id: "first", sourceKey: "reply-1", segments: [{ start: 0, end: 5 }] };
  const second = { id: "second", sourceKey: "reply-2", segments: [{ start: 0, end: 5 }] };
  assert.deepEqual(plain(applyMark([first], second)), [first, second]);
});

test("DSH 0.2.x resolves the open session from uiSession", () => {
  const uiSession = { adapter: { current: { value: { props: { sessionId: "open-1" } } } } };
  const sessions = { list: { getSnapshot: () => ({ ids: ["open-1"] }) } };
  assert.equal(activeSessionId(uiSession, sessions), "open-1");
});

test("saved palette settings keep nine valid labels and bounded tooltips", () => {
  const labels = Array.from({ length: 11 }, (_, index) => ({
    id: `label-${index}`, name: `标签${index}`, color: "#123456",
    mode: "retain", description: "说明".repeat(20)
  }));
  const settings = normalizeSettings({ labels, custom: { color: "bad", description: "要求".repeat(20) } });
  assert.equal(settings.labels.length, 9);
  assert.equal(settings.labels[0].description.length, 24);
  assert.equal(settings.custom.color, "#B7BEC8");
  assert.equal(settings.custom.description.length, 24);
});

test("old exact rule migrates to the new retain option", () => {
  const settings = normalizeSettings({ labels: [{ id: "exact", mode: "exact" }] });
  assert.equal(settings.labels[0].mode, "retain");
});
