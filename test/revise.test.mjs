import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearReplyMarks, mergeSyncedPayload, revisionText } from '../lib/revise.js';

const events = [
  { type: 'assistant/message', seq: 7, data: { turn: 2, message: { content: [{ type: 'text', text: '第一部分很清楚。\n第二部分太抽象。' }] } } },
  { type: 'turn/end', seq: 8, data: { turn: 2 } }
];
const settings = { labels: [
  { id: 'green', name: '掌握了', description: '保留重点', mode: 'retain' },
  { id: 'red', name: '删掉', description: '不需要', mode: 'delete' }
] };
const record = {
  marks: [
    { sourceKey: 'old', labelId: 'red', segments: [{ start: 0, end: 2 }] },
    { sourceKey: 'new', labelId: 'green', segments: [{ start: 0, end: 7 }], note: '这一句好记' }
  ],
  sources: {
    old: { turn: '1', rowIndex: 0, text: '旧回复' },
    new: { turn: '2', rowIndex: 0, text: '第一部分很清楚。' }
  }
};

test('revision includes complete latest reply, matching marks and global direction', () => {
  const prompt = revisionText(events, record, settings, '第二部分说具体一点');
  assert.match(prompt, /第一部分很清楚。\n第二部分太抽象。/);
  assert.match(prompt, /第一部分很清楚/);
  assert.match(prompt, /这一句好记/);
  assert.match(prompt, /第二部分说具体一点/);
  assert.doesNotMatch(prompt, /旧回复/);
  assert.match(prompt, /不要求逐字不改/);
});

test('revision waits for a completed assistant turn', () => {
  assert.throws(() => revisionText(events.slice(0, 1), record, settings, '修改'), /尚未结束/);
});

test('revision needs a mark on latest reply or global instruction', () => {
  assert.throws(() => revisionText(events, { marks: [], sources: {} }, settings, '  '), /请先标注/);
});

test('revision asks to keep unmarked wording unless a change is necessary', () => {
  const prompt = revisionText(events, record, settings, '');
  assert.match(prompt, /未标注的内容默认保留原句、措辞和结构/);
  assert.match(prompt, /避免无意义的同义改写/);
  assert.match(prompt, /对文本质量不满意.*修改相关内容，包括必要的未标注部分/);
  assert.match(prompt, /对结构不满意.*以调整结构为主/);
  assert.match(prompt, /标注片段都须满足对应颜色的含义、文本生成要求和补充说明/);
});

test('submission clears all old marks and stale sync cannot restore them', () => {
  const payload = {
    sessionId: 'session', settings,
    record: {
      marks: [
        { id: 'older', sourceKey: 'old' },
        { id: 'revised', sourceKey: 'new' }
      ],
      sources: {
        old: { turn: '1', text: 'older text' },
        new: { turn: '2', text: 'revised text' }
      }
    }
  };
  const cleared = clearReplyMarks(payload);
  assert.deepEqual(cleared.clearedMarkIds, ['older', 'revised']);
  assert.deepEqual(cleared.record.marks, []);
  assert.deepEqual(cleared.record.sources, {});
  const staleSync = mergeSyncedPayload(cleared, payload);
  assert.deepEqual(staleSync.record.marks, []);
  assert.deepEqual(staleSync.clearedMarkIds, ['older', 'revised']);
});
