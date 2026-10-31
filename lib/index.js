import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MAX_SYNC_BYTES, clearReplyMarks, mergeSyncedPayload, revisionText } from './revise.js';

const sessionOperations = new Map();

function inSessionOrder(sessionId, operation) {
  const previous = sessionOperations.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  sessionOperations.set(sessionId, current);
  current.then(
    () => { if (sessionOperations.get(sessionId) === current) sessionOperations.delete(sessionId); },
    () => { if (sessionOperations.get(sessionId) === current) sessionOperations.delete(sessionId); }
  );
  return current;
}

function fileFor(home, sessionId) {
  return join(home, 'context-mark', `${createHash('sha256').update(sessionId).digest('hex')}.json`);
}

async function saveSnapshot(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(data), 'utf8');
  await rename(temporary, path);
}

async function readSnapshot(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

export function apply(ctx) {
  const home = ctx.get?.('profileContext', false)?.home;
  if (!home) throw new Error('context-mark: 无法获取 DSH 数据目录');

  ctx.inject(['connection'], connected => {
    connected.connection.fetch.register({
      path: '/api/context-mark/sync',
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        if (Number(request.headers.get('content-length')) > MAX_SYNC_BYTES) return new Response('批注数据过大', { status: 413 });
        let payload;
        try { payload = await request.json(); } catch { return new Response('JSON 无效', { status: 400 }); }
        if (!payload || typeof payload.sessionId !== 'string' || !payload.sessionId
          || !Array.isArray(payload.record?.marks) || typeof payload.record?.sources !== 'object'
          || !Array.isArray(payload.settings?.labels)) return new Response('批注格式无效', { status: 400 });
        if (Buffer.byteLength(JSON.stringify(payload)) > MAX_SYNC_BYTES) return new Response('批注数据过大', { status: 413 });
        return inSessionOrder(payload.sessionId, async () => {
          const path = fileFor(home, payload.sessionId);
          const previous = await readSnapshot(path);
          const merged = mergeSyncedPayload(previous, payload);
          await saveSnapshot(path, merged);
          return Response.json({ saved: true, clearedMarkIds: merged.clearedMarkIds });
        });
      }
    });
    connected.connection.fetch.register({
      path: '/api/context-mark/status',
      methods: ['GET'],
      requestBody: 'buffered',
      async fetch(request) {
        const sessionId = new URL(request.url, 'http://localhost').searchParams.get('sessionId');
        if (!sessionId) return new Response('缺少会话', { status: 400 });
        return inSessionOrder(sessionId, async () => {
          const payload = await readSnapshot(fileFor(home, sessionId));
          return Response.json({ clearedMarkIds: payload?.clearedMarkIds ?? [] });
        });
      }
    });
  });

  ctx.inject(['commands'], commandCtx => {
    commandCtx.commands.register({
      name: 'mark-revise',
      description: '依据上一条 AI 回复、颜色批注和整体要求生成新版本',
      input: { hint: '[整体修改要求]' },
      async handler({ agent, rawInput }) {
        const sessionId = String(agent.session.id);
        return inSessionOrder(sessionId, async () => {
          const path = fileFor(home, sessionId);
          let payload;
          try { payload = await readSnapshot(path); }
          catch { return { kind: 'error', text: '批注数据读取失败，请检查 DSH 数据目录。' }; }
          if (!payload) return { kind: 'error', text: '未找到同步的批注。请打开这个会话，等待标注插件加载后再试。' };
          if (payload.sessionId !== sessionId) return { kind: 'error', text: '批注与当前会话不匹配。' };
          try {
            const events = agent.session.snapshotEvents();
            const prompt = revisionText(events, payload.record, payload.settings, rawInput);
            const cleared = clearReplyMarks(payload);
            await saveSnapshot(path, cleared);
            try {
              agent.steer(Object.freeze({
                id: randomUUID(), role: 'user',
                content: Object.freeze([{ type: 'text', text: prompt }]),
                source: Object.freeze({ kind: 'user' })
              }));
            } catch (error) {
              await saveSnapshot(path, payload);
              throw error;
            }
            return { kind: 'success', text: '已提交修订要求，并清除当前会话的旧批注。' };
          } catch (error) {
            return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
          }
        });
      }
    });
  });
}
