export const MAX_SYNC_BYTES = 2 * 1024 * 1024;

export function latestCompletedReply(events) {
  const lastAssistantEvent = [...events].reverse().find(event => event.type === 'assistant/message');
  if (!lastAssistantEvent) throw new Error('尚未找到完整的 AI 回复，请等待生成结束。');
  const lastEnd = [...events].reverse().find(event => event.type === 'turn/end'
    && event.data?.turn === lastAssistantEvent.data?.turn);
  if (!lastEnd || lastEnd.seq < lastAssistantEvent.seq) throw new Error('AI 回复尚未结束，请稍后再试。');
  const original = (lastAssistantEvent.data?.message?.content ?? [])
    .filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
  if (!original) throw new Error('上一条 AI 回复没有可修改的正文。');
  return { turn: String(lastAssistantEvent.data?.turn ?? ''), original };
}

export function excludeClearedMarks(record, clearedMarkIds) {
  const cleared = new Set(clearedMarkIds);
  const marks = (record?.marks ?? []).filter(mark => !cleared.has(mark.id));
  const referenced = new Set(marks.map(mark => mark.sourceKey));
  const sources = Object.fromEntries(Object.entries(record?.sources ?? {})
    .filter(([sourceKey]) => referenced.has(sourceKey)));
  return { marks, sources };
}

export function mergeSyncedPayload(previous, incoming) {
  const clearedMarkIds = Array.isArray(previous?.clearedMarkIds) ? previous.clearedMarkIds : [];
  return { ...incoming, clearedMarkIds, record: excludeClearedMarks(incoming.record, clearedMarkIds) };
}

export function clearReplyMarks(payload) {
  const ids = payload.record.marks.map(mark => mark.id);
  const clearedMarkIds = [...new Set([...(payload.clearedMarkIds ?? []), ...ids])];
  return { ...payload, clearedMarkIds, record: excludeClearedMarks(payload.record, clearedMarkIds) };
}

export function revisionText(events, record, settings, globalInstruction) {
  const { turn, original } = latestCompletedReply(events);

  const labels = new Map([...(settings?.labels ?? []), settings?.custom].filter(Boolean).map(label => [label.id, label]));
  const annotations = [];
  for (const mark of record?.marks ?? []) {
    const source = record.sources?.[mark.sourceKey];
    if (!source || String(source.turn) !== turn || typeof source.text !== 'string') continue;
    const label = labels.get(mark.labelId) ?? mark.labelSnapshot;
    if (!label) continue;
    for (const segment of mark.segments ?? []) {
      if (!Number.isSafeInteger(segment.start) || !Number.isSafeInteger(segment.end)
        || segment.start < 0 || segment.end > source.text.length || segment.start >= segment.end) continue;
      const excerpt = source.text.slice(segment.start, segment.end);
      if (!excerpt.trim()) continue;
      annotations.push({
        order: Number(source.rowIndex) * 1_000_000 + segment.start,
        excerpt,
        label: label.name,
        meaning: label.description ?? '',
        requirement: label.mode === 'retain' || label.mode === 'exact' ? '保留内容' : label.mode === 'delete' ? '删除内容' : '无强制要求',
        note: mark.note?.trim() ?? ''
      });
    }
  }
  annotations.sort((a, b) => a.order - b.order);
  const instruction = globalInstruction.trim();
  if (!annotations.length && !instruction) throw new Error('请先标注这条回复，或在命令后写整体修改要求。');
  const markText = annotations.length ? annotations.map((item, i) =>
    `${i + 1}. 原文片段：${JSON.stringify(item.excerpt)}\n   标签：${item.label}；含义：${item.meaning}；文本生成要求：${item.requirement}${item.note ? `\n   补充说明：${item.note}` : ''}`
  ).join('\n') : '无局部批注。';
  return `请根据下面的原文、局部批注和整体修改要求，生成一份完整的新版本。保持原文的主题和用途，先判断整体要求针对的问题，再决定修改范围。\n\n未标注的内容默认保留原句、措辞和结构，避免无意义的同义改写。如果整体要求对文本质量不满意，就针对指出的问题修改相关内容，包括必要的未标注部分；不要借此重写无关内容。如果整体要求对结构不满意，就以调整结构为主，按需要移动、合并或拆分段落，并修改必要的衔接文字。若整体要求未涉及某处，仅在处理局部批注后为保证连贯、准确确有必要时才修改该处。\n\n无论整体要求是什么，标注片段都须满足对应颜色的含义、文本生成要求和补充说明。“保留内容”表示保留核心内容并尽量沿用原有表述；允许为满足本次整体要求或保证连贯、准确作必要调整，不要求逐字不改。“删除内容”表示新版本去掉该片段表达的内容。\n\n<原文>\n${original}\n</原文>\n\n<局部批注>\n${markText}\n</局部批注>\n\n<整体修改要求>\n${instruction || '无额外整体要求。'}\n</整体修改要求>\n\n请直接输出修改后的完整文本。`;
}
