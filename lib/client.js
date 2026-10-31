// A dependency-free DSH browser plugin. The model and view are kept separate so
// a later host storage adapter can replace localStorage without changing marks.
window.__ModuleLoader__.load({
  id: "context-mark-dsh",
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;
    const VERSION = "0.4.1";
    const KEY = Symbol.for("context-mark-dsh.client");
    const TRANSCRIPT = '[data-slot="conversation.session"]';
    const SETTINGS_KEY = "context-mark/settings/v1";
    const MAX_LABELS = 9;
    const CLASSIC_COLORS = ["#A3E6B0", "#FFE08A", "#FFAAA5", "#A9D8FF", "#D6BBFF", "#FFBF86", "#8EDDD1", "#F5B6D2", "#B7BEC8"];
    const DEFAULT_LABELS = [
      { id: "exact", name: "重点保留", color: "#A3E6B0", mode: "retain", description: "保留重点，尽量少改" },
      { id: "editable", name: "可改写", color: "#FFE08A", mode: "retain", description: "保留内容，可以调整说法" },
      { id: "remove", name: "删除", color: "#FFAAA5", mode: "delete", description: "这部分不需要，后续去掉" },
      { id: "expand", name: "展开说明", color: "#A9D8FF", mode: "retain", description: "保留并展开讲清楚" },
      { id: "rephrase", name: "换个说法", color: "#D6BBFF", mode: "retain", description: "保留意思，换种表达" }
    ];
    const DEFAULT_CUSTOM = { id: "custom", name: "自定义标注", color: "#B7BEC8", mode: "none", description: "写下对这处文字的具体要求" };

    function validColor(value) {
      return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
    }

    function contrastText(color) {
      const channels = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
      const luminance = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return (0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2]) < 0.4 ? "#fff" : "#1b1b1b";
    }

    function normalizeLabel(value, fallback) {
      const oldDefault = fallback.id === "exact"
        && value?.name === "原样保留" && value?.description === "逐字保留，不要改写";
      return {
        id: fallback.id,
        name: String(oldDefault ? fallback.name : value?.name ?? fallback.name).trim().slice(0, 10) || fallback.name,
        color: validColor(value?.color) ? value.color.toUpperCase() : fallback.color,
        mode: value?.mode === "exact" ? "retain"
          : ["none", "retain", "delete"].includes(value?.mode) ? value.mode : fallback.mode,
        description: String(oldDefault ? fallback.description : value?.description ?? fallback.description).trim().slice(0, 24)
      };
    }

    function normalizeSettings(value) {
      const rawLabels = Array.isArray(value?.labels) ? value.labels : DEFAULT_LABELS;
      const used = new Set();
      const labels = [];
      for (const raw of rawLabels) {
        if (labels.length === MAX_LABELS) break;
        if (!raw || typeof raw.id !== "string" || !/^[a-z0-9_-]+$/.test(raw.id) || raw.id === "custom" || used.has(raw.id)) continue;
        const fallback = DEFAULT_LABELS.find(item => item.id === raw.id)
          ?? { id: raw.id, name: "新标签", color: CLASSIC_COLORS[labels.length], mode: "none", description: "" };
        labels.push(normalizeLabel(raw, fallback));
        used.add(raw.id);
      }
      return { labels, custom: normalizeLabel(value?.custom, DEFAULT_CUSTOM) };
    }

    function subtractSegments(segments, start, end) {
      const overlaps = segments.some(part => part.start < end && start < part.end);
      if (overlaps) {
        const first = Math.min(...segments.map(part => part.start));
        const last = Math.max(...segments.map(part => part.end));
        if (first < start && end < last) return [];
      }
      const result = [];
      for (const part of segments) {
        if (part.end <= start || part.start >= end) {
          result.push(part);
          continue;
        }
        if (part.start < start) result.push({ start: part.start, end: start });
        if (part.end > end) result.push({ start: end, end: part.end });
      }
      return result;
    }

    // A middle overlap removes the old mark; an edge overlap only trims it.
    function applyMark(marks, mark) {
      const result = [];
      for (const old of marks) {
        if (old.sourceKey !== mark.sourceKey) {
          result.push(old);
          continue;
        }
        const segments = subtractSegments(old.segments, mark.segments[0].start, mark.segments[0].end);
        if (segments.length) result.push({ ...old, segments });
      }
      result.push(mark);
      return result;
    }

    function hashText(text) {
      let value = 2166136261;
      for (let i = 0; i < text.length; i++) {
        value ^= text.charCodeAt(i);
        value = Math.imul(value, 16777619);
      }
      return (value >>> 0).toString(36);
    }

    function activeSessionId(uiSession, sessions) {
      const current = uiSession?.adapter?.current?.value;
      return current?.props?.sessionId
        ?? current?.key
        ?? sessions?.list?.getSnapshot?.()?.current
        ?? null;
    }

    function createElement(tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }

    function nearestRow(node) {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      return element?.closest?.("[data-chat-turn]") ?? null;
    }

    function selectionSnapshot() {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
      const range = selection.getRangeAt(0);
      const row = nearestRow(range.startContainer);
      if (!row || row !== nearestRow(range.endContainer) || !row.closest(TRANSCRIPT)) return null;
      if (row.getAttribute("data-chat-flow-kind") !== "assistant-step") return null;
      const text = range.toString();
      if (!text.trim()) return null;
      const before = document.createRange();
      before.selectNodeContents(row);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      const end = start + text.length;
      const turn = row.getAttribute("data-chat-turn") ?? "";
      const sameTurn = [...row.closest(TRANSCRIPT).querySelectorAll("[data-chat-turn]")]
        .filter(candidate => candidate.getAttribute("data-chat-turn") === turn);
      const rowIndex = sameTurn.indexOf(row);
      const sourceText = row.textContent ?? "";
      const sourceKey = `${turn}:${rowIndex}:${hashText(sourceText)}`;
      return { range: range.cloneRange(), row, text, start, end, turn, rowIndex, sourceText, sourceKey };
    }

    function rangeAt(row, start, end) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let node;
      let offset = 0;
      let first = null;
      let last = null;
      while ((node = walker.nextNode())) {
        const next = offset + node.textContent.length;
        if (!first && start >= offset && start < next) first = [node, start - offset];
        if (!last && end > offset && end <= next) last = [node, end - offset];
        offset = next;
      }
      if (!first || !last) return null;
      const range = document.createRange();
      range.setStart(first[0], first[1]);
      range.setEnd(last[0], last[1]);
      return range;
    }

    function resolveRow(source) {
      const transcript = document.querySelector(TRANSCRIPT);
      if (!transcript) return null;
      const rows = [...transcript.querySelectorAll("[data-chat-turn]")]
        .filter(row => row.getAttribute("data-chat-turn") === source.turn);
      const indexed = rows[source.rowIndex];
      const exact = indexed && hashText(indexed.textContent ?? "") === source.hash
        ? indexed : rows.find(row => hashText(row.textContent ?? "") === source.hash);
      return exact ?? rows[source.rowIndex] ?? null;
    }

    function apply(ctx) {
      const old = globalThis[KEY];
      if (old?.version === VERSION) return;
      old?.dispose?.();
      for (const node of document.querySelectorAll(".cm-launch,.cm-palette,.cm-panel,.cm-note-box,.cm-notice")) node.remove();
      for (const node of document.querySelectorAll("style")) {
        if (node.textContent?.includes(".cm-launch") && node.textContent.includes(".cm-palette")) node.remove();
      }

      const uiSession = ctx?.get?.("uiSession");
      const sessions = ctx?.get?.("sessions");
      let settings;
      try {
        settings = normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"));
      } catch {
        settings = normalizeSettings(null);
      }
      let sessionId = undefined;
      let record = { marks: [], sources: {} };
      let pending = null;
      let palette = null;
      let panel = null;
      let noteBox = null;
      let launch = null;
      let style = null;
      let highlightStyle = null;
      let panelView = "marks";
      let disposed = false;
      let observedTranscript = null;
      let transcriptObserver = null;
      let syncTimer = null;
      let syncPending = false;
      let syncing = false;
      let syncError = "";
      let checkingClearance = false;
      let lastClearanceCheck = 0;
      const highlightNames = new Set();

      function applyClearance(ids, targetSessionId) {
        if (targetSessionId !== sessionId || !Array.isArray(ids) || !ids.length) return;
        const cleared = new Set(ids);
        const marks = record.marks.filter(mark => !cleared.has(mark.id));
        if (marks.length === record.marks.length) return;
        const referenced = new Set(marks.map(mark => mark.sourceKey));
        record = { marks, sources: Object.fromEntries(Object.entries(record.sources)
          .filter(([sourceKey]) => referenced.has(sourceKey))) };
        save();
        refreshStyle();
        paint();
        if (panel && !panel.hidden) renderPanel();
      }

      async function checkClearance() {
        const id = sessionId;
        if (!id || disposed || checkingClearance) return;
        checkingClearance = true;
        try {
          const response = await fetch(`/api/context-mark/status?sessionId=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const status = await response.json();
          applyClearance(status.clearedMarkIds, id);
        } catch (error) {
          console.warn('[context-mark] Could not check cleared annotations', error);
        } finally {
          checkingClearance = false;
        }
      }

      function scheduleSync(delay = 150) {
        if (!sessionId || disposed) return;
        syncPending = true;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(syncToHost, delay);
      }

      async function syncToHost() {
        syncTimer = null;
        if (syncing || !syncPending || disposed || !sessionId) return;
        syncing = true;
        syncPending = false;
        const payload = { sessionId, record, settings };
        try {
          const response = await fetch('/api/context-mark/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const result = await response.json();
          applyClearance(result.clearedMarkIds, payload.sessionId);
          if (syncError) { syncError = ""; if (panel && !panel.hidden) renderPanel(); }
        } catch (error) {
          syncPending = true;
          console.warn('[context-mark] Could not sync annotations to Host', error);
          const message = error instanceof Error ? error.message : String(error);
          if (syncError !== message) { syncError = message; if (panel && !panel.hidden) renderPanel(); }
          clearTimeout(syncTimer);
          syncTimer = setTimeout(syncToHost, 5000);
        } finally {
          syncing = false;
          if (syncPending && !syncTimer) scheduleSync(0);
        }
      }

      function currentSession() {
        return activeSessionId(uiSession, sessions);
      }

      function allLabels() {
        const labels = new Map(DEFAULT_LABELS.map(label => [label.id, label]));
        for (const mark of record.marks) {
          if (mark.labelSnapshot && !labels.has(mark.labelId)) labels.set(mark.labelId, mark.labelSnapshot);
        }
        for (const label of settings.labels) labels.set(label.id, label);
        labels.set("custom", settings.custom);
        return [...labels.values()];
      }

      function labelFor(mark) {
        return allLabels().find(label => label.id === mark.labelId) ?? mark.labelSnapshot;
      }

      function refreshStyle() {
        if (!highlightStyle) return;
        highlightStyle.textContent = allLabels()
          .filter(label => /^[a-z0-9_-]+$/.test(label.id) && validColor(label.color))
          .map(label => `::highlight(cm-${label.id}) { background-color: ${label.color}; color: ${contrastText(label.color)}; }`)
          .join("\n");
      }

      function saveSettings() {
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (error) {
          console.warn("[context-mark] Could not save settings", error);
          notify("设置未能保存，请检查本地存储空间。");
        }
        refreshStyle();
        scheduleSync();
        paint();
        if (panelView === "marks" && panel && !panel.hidden) renderPanel();
        if (pending && palette && !palette.hidden) showPalette(pending);
      }

      function load() {
        const id = currentSession();
        if (id === sessionId) return;
        sessionId = id;
        try {
          const parsed = id ? JSON.parse(localStorage.getItem(`context-mark/v1/${id}`) ?? "null") : null;
          record = parsed && Array.isArray(parsed.marks) && parsed.sources && typeof parsed.sources === "object"
            ? parsed : { marks: [], sources: {} };
        } catch {
          record = { marks: [], sources: {} };
        }
        pending = null;
        hidePalette();
        closeNoteBox();
        if (launch) launch.hidden = !id;
        if (!id && panel) panel.hidden = true;
        refreshStyle();
        renderPanel();
        paint(true);
        scheduleSync();
        void checkClearance();
      }

      function save() {
        if (!sessionId) return;
        try {
          localStorage.setItem(`context-mark/v1/${sessionId}`, JSON.stringify(record));
        } catch (error) {
          console.warn("[context-mark] Could not save annotations", error);
          notify("标注未能保存，请检查本地存储空间。");
        }
        scheduleSync();
      }

      function notify(message) {
        const notice = createElement("div", "cm-notice", message);
        document.body.appendChild(notice);
        setTimeout(() => notice.remove(), 3500);
      }

      function hidePalette() {
        if (palette) palette.hidden = true;
      }

      function showPalette(snapshot) {
        if (!sessionId) return;
        pending = snapshot;
        palette.replaceChildren();
        for (const label of settings.labels) {
          const button = createElement("button", "cm-color");
          button.type = "button";
          button.setAttribute("aria-label", `${label.name}：${label.description}`);
          button.dataset.tooltip = `${label.name}${label.description ? `：${label.description}` : ""}`;
          button.style.setProperty("--cm-color", label.color);
          button.addEventListener("mousedown", event => event.preventDefault());
          button.addEventListener("click", () => addSelection(label));
          palette.appendChild(button);
        }
        const pen = createElement("button", "cm-pen");
        pen.type = "button";
        pen.setAttribute("aria-label", settings.custom.name);
        pen.dataset.tooltip = `${settings.custom.name}：${settings.custom.description}`;
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("aria-hidden", "true");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z");
        icon.appendChild(path);
        pen.appendChild(icon);
        pen.addEventListener("mousedown", event => event.preventDefault());
        pen.addEventListener("click", openCustomNote);
        palette.appendChild(pen);
        const rect = snapshot.range.getBoundingClientRect();
        palette.hidden = false;
        const width = palette.offsetWidth;
        palette.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
        palette.style.top = `${Math.max(8, rect.top > 62 ? rect.top - 52 : rect.bottom + 8)}px`;
      }

      function addSelection(label, note = "", snapshot = pending) {
        if (!snapshot || !sessionId) return;
        record.sources[snapshot.sourceKey] = {
          turn: snapshot.turn,
          rowIndex: snapshot.rowIndex,
          hash: hashText(snapshot.sourceText),
          text: snapshot.sourceText
        };
        const mark = {
          id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
          sourceKey: snapshot.sourceKey,
          labelId: label.id,
          labelSnapshot: { ...label },
          segments: [{ start: snapshot.start, end: snapshot.end }],
          note
        };
        record.marks = applyMark(record.marks, mark);
        save();
        pending = null;
        hidePalette();
        document.getSelection()?.removeAllRanges();
        if (panel && !panel.hidden && panelView === "marks") renderPanel();
        refreshStyle();
        paint(true);
      }

      function closeNoteBox() {
        noteBox?.remove();
        noteBox = null;
      }

      function openCustomNote() {
        const snapshot = pending;
        if (!snapshot) return;
        hidePalette();
        closeNoteBox();
        const box = createElement("div", "cm-note-box");
        const head = createElement("div", "cm-head");
        head.appendChild(createElement("strong", "", "自定义标注"));
        const cancel = createElement("button", "cm-close", "×");
        cancel.type = "button";
        cancel.setAttribute("aria-label", "取消自定义标注");
        cancel.addEventListener("click", () => { closeNoteBox(); pending = null; });
        head.appendChild(cancel);
        const excerpt = createElement("div", "cm-note-excerpt", snapshot.text);
        const input = createElement("textarea", "cm-note");
        input.placeholder = "写下这处文字需要怎么处理…";
        input.rows = 3;
        const saveButton = createElement("button", "cm-save-note", "保存标注");
        saveButton.type = "button";
        saveButton.addEventListener("click", () => {
          const note = input.value.trim();
          if (!note) { input.focus(); notify("先写下自定义标注的说明。"); return; }
          addSelection(settings.custom, note, snapshot);
          closeNoteBox();
        });
        box.addEventListener("keydown", event => {
          if (event.key === "Escape") { event.preventDefault(); closeNoteBox(); pending = null; }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) saveButton.click();
        });
        box.append(head, excerpt, input, saveButton);
        document.body.appendChild(box);
        noteBox = box;
        const rect = snapshot.range.getBoundingClientRect();
        box.style.left = `${Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, rect.left))}px`;
        box.style.top = `${rect.bottom + box.offsetHeight + 12 < window.innerHeight
          ? rect.bottom + 8 : Math.max(8, rect.top - box.offsetHeight - 8)}px`;
        document.getSelection()?.removeAllRanges();
        input.focus();
      }

      function paint() {
        if (!globalThis.CSS?.highlights || !globalThis.Highlight) return;
        const transcript = document.querySelector(TRANSCRIPT);
        for (const name of highlightNames) CSS.highlights.delete(name);
        highlightNames.clear();
        if (!sessionId || !transcript) return;
        for (const label of allLabels()) {
          const ranges = [];
          for (const mark of record.marks) {
            if (mark.labelId !== label.id) continue;
            const source = record.sources[mark.sourceKey];
            const row = source && resolveRow(source);
            if (!row || (row.textContent ?? "") !== source.text) continue;
            for (const segment of mark.segments) {
              const range = rangeAt(row, segment.start, segment.end);
              if (range) ranges.push(range);
            }
          }
          if (ranges.length) {
            const name = `cm-${label.id}`;
            CSS.highlights.set(name, new Highlight(...ranges));
            highlightNames.add(name);
          }
        }
      }

      function marksInTextOrder() {
        const positions = new Map(record.marks.map(mark => {
          const source = record.sources[mark.sourceKey];
          return [mark, {
            source,
            row: source ? resolveRow(source) : null,
            start: Math.min(...mark.segments.map(segment => segment.start))
          }];
        }));
        return [...record.marks].sort((left, right) => {
          const a = positions.get(left);
          const b = positions.get(right);
          if (a.row && b.row && a.row !== b.row) {
            const order = a.row.compareDocumentPosition(b.row);
            if (order & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
            if (order & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          }
          if (left.sourceKey !== right.sourceKey) {
            const aTurn = Number(a.source?.turn);
            const bTurn = Number(b.source?.turn);
            if (Number.isSafeInteger(aTurn) && Number.isSafeInteger(bTurn) && aTurn !== bTurn) {
              return aTurn - bTurn;
            }
            const rowOrder = (a.source?.rowIndex ?? 0) - (b.source?.rowIndex ?? 0);
            if (rowOrder) return rowOrder;
          }
          return a.start - b.start;
        });
      }

      function renderPanel() {
        if (!panel) return;
        panel.replaceChildren();
        const head = createElement("div", "cm-head");
        head.append(createElement("strong", "", panelView === "settings" ? "标注设置" : "回复标注"));
        const switchView = createElement("button", "cm-view-switch", panelView === "settings" ? "返回标注" : "设置");
        switchView.type = "button";
        switchView.addEventListener("click", () => {
          panelView = panelView === "settings" ? "marks" : "settings";
          renderPanel();
        });
        head.append(switchView);
        const close = createElement("button", "cm-close", "×");
        close.type = "button";
        close.setAttribute("aria-label", "关闭标注面板");
        close.addEventListener("click", () => { panel.hidden = true; });
        head.append(close);
        panel.append(head);
        if (syncError) panel.append(createElement("p", "cm-sync-error", `批注尚未同步到 DSH：${syncError}`));
        if (panelView === "settings") { renderSettings(); return; }
        panel.append(createElement("p", "cm-hint", "修改这条回复：在输入框输入 /mark-revise 加整体修改要求后发送。"));
        panel.append(createElement("p", "cm-hint", "颜色会直接标记；需要时再点“添加补充说明”。"));
        if (!record.marks.length) {
          panel.append(createElement("p", "cm-empty", "这个会话还没有标注。"));
          return;
        }
        const list = createElement("div", "cm-list");
        for (const mark of marksInTextOrder()) {
          const label = labelFor(mark);
          const source = record.sources[mark.sourceKey];
          if (!label || !source) continue;
          const item = createElement("section", "cm-item");
          item.style.setProperty("--cm-color", label.color);
          item.style.setProperty("--cm-on-color", contrastText(label.color));
          const top = createElement("div", "cm-item-top");
          top.append(createElement("span", "cm-tag", label.name));
          const actions = createElement("div", "cm-item-actions");
          const noteAction = createElement("button", "cm-add-note", mark.note?.trim() ? "编辑补充说明" : "添加补充说明");
          noteAction.type = "button";
          const remove = createElement("button", "cm-remove", "移除");
          remove.type = "button";
          remove.setAttribute("aria-label", "移除这条标注");
          remove.addEventListener("click", () => {
            record.marks = record.marks.filter(item => item.id !== mark.id);
            save(); renderPanel(); paint(true);
          });
          actions.append(noteAction, remove);
          top.append(actions);
          const excerpt = mark.segments.map(part => source.text.slice(part.start, part.end)).join(" … ");
          const quote = createElement("div", "cm-quote", excerpt);
          const noteContent = createElement("div", "cm-note-content");
          if (mark.note?.trim()) noteContent.appendChild(createElement("div", "cm-note-preview", mark.note));
          noteAction.addEventListener("click", () => {
            noteContent.replaceChildren();
            const note = createElement("textarea", "cm-note");
            note.placeholder = "对这处文字补充说明";
            note.value = mark.note ?? "";
            note.rows = 2;
            note.addEventListener("input", () => {
              mark.note = note.value;
              noteAction.textContent = mark.note.trim() ? "编辑补充说明" : "添加补充说明";
              save();
            });
            const done = createElement("button", "cm-note-done", "完成");
            done.type = "button";
            done.addEventListener("click", () => renderPanel());
            noteContent.append(note, done);
            note.focus();
          });
          item.append(top, quote, noteContent);
          list.append(item);
        }
        panel.append(list);
      }

      function renderSettings() {
        panel.append(createElement("p", "cm-hint", "“保留内容”表示保留核心信息并尽量少改，模型可为连贯和准确作必要调整；不要求逐字不变。"));
        panel.append(createElement("p", "cm-hint", "说明最多 24 字，悬停颜色时会显示。设置自动保存在本机。"));
        const count = createElement("div", "cm-settings-heading");
        count.appendChild(createElement("strong", "", `颜色标签 ${settings.labels.length}/${MAX_LABELS}`));
        const add = createElement("button", "cm-add", "添加颜色");
        add.type = "button";
        add.disabled = settings.labels.length >= MAX_LABELS;
        add.addEventListener("click", () => {
          const id = `label-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          settings.labels.push({ id, name: "新标签", color: CLASSIC_COLORS[settings.labels.length], mode: "none", description: "填写这个颜色的标注含义" });
          saveSettings();
          renderPanel();
        });
        count.appendChild(add);
        panel.appendChild(count);
        for (const label of settings.labels) panel.appendChild(settingCard(label, false));
        panel.append(createElement("h3", "cm-settings-heading", "自定义笔"));
        panel.appendChild(settingCard(settings.custom, true));
      }

      function settingCard(label, isCustom) {
        const card = createElement("section", "cm-setting-card");
        const heading = createElement("div", "cm-setting-row");
        const preview = createElement("span", "cm-setting-preview");
        preview.style.backgroundColor = label.color;
        heading.appendChild(preview);
        if (isCustom) {
          heading.appendChild(createElement("strong", "", "笔的标注颜色"));
        } else {
          const name = createElement("input", "cm-setting-name");
          name.type = "text";
          name.maxLength = 10;
          name.value = label.name;
          name.setAttribute("aria-label", "标签名称，最多10字");
          name.addEventListener("input", () => { label.name = name.value.slice(0, 10); saveSettings(); });
          heading.appendChild(name);
          const remove = createElement("button", "cm-setting-remove", "移除");
          remove.type = "button";
          remove.addEventListener("click", () => {
            settings.labels = settings.labels.filter(item => item.id !== label.id);
            saveSettings();
            renderPanel();
          });
          heading.appendChild(remove);
        }
        card.appendChild(heading);
        const description = createElement("input", "cm-setting-description");
        description.type = "text";
        description.maxLength = 24;
        description.placeholder = "悬停时显示的标注含义（最多24字）";
        description.value = label.description;
        description.setAttribute("aria-label", "标注含义，最多24字");
        const length = createElement("span", "cm-length", `${label.description.length}/24`);
        description.addEventListener("input", () => {
          label.description = description.value.slice(0, 24);
          length.textContent = `${label.description.length}/24`;
          saveSettings();
        });
        card.append(description, length);
        if (!isCustom) {
          const modeRow = createElement("label", "cm-mode-row", "文本生成要求");
          const mode = createElement("select", "cm-setting-mode");
          for (const [value, text] of [["none", "无强制要求"], ["retain", "保留内容"], ["delete", "删除内容"]]) {
            const option = createElement("option", "", text);
            option.value = value;
            mode.appendChild(option);
          }
          mode.value = label.mode;
          mode.addEventListener("change", () => { label.mode = mode.value; saveSettings(); });
          modeRow.appendChild(mode);
          card.appendChild(modeRow);
        }
        const colors = createElement("div", "cm-color-choices");
        for (const color of CLASSIC_COLORS) {
          const swatch = createElement("button", "cm-choice");
          swatch.type = "button";
          swatch.style.backgroundColor = color;
          swatch.setAttribute("aria-label", `使用颜色 ${color}`);
          swatch.setAttribute("aria-pressed", label.color.toUpperCase() === color ? "true" : "false");
          swatch.addEventListener("click", () => {
            label.color = color;
            saveSettings();
            renderPanel();
          });
          colors.appendChild(swatch);
        }
        card.appendChild(colors);
        const hexRow = createElement("label", "cm-hex-row", "自定义色号");
        const hex = createElement("input", "cm-hex");
        hex.type = "text";
        hex.maxLength = 7;
        hex.placeholder = "#A3E6B0";
        hex.value = label.color;
        hex.addEventListener("change", () => {
          const value = hex.value.trim();
          if (!validColor(value)) { hex.value = label.color; notify("请输入 #RRGGBB 格式的色号。"); return; }
          label.color = value.toUpperCase();
          preview.style.backgroundColor = label.color;
          saveSettings();
          renderPanel();
        });
        hexRow.appendChild(hex);
        card.appendChild(hexRow);
        return card;
      }

      function onSelection() {
        if (disposed) return;
        const snapshot = selectionSnapshot();
        if (snapshot) showPalette(snapshot);
        else hidePalette();
      }

      const css = DEFAULT_LABELS.map(label =>
        `::highlight(cm-${label.id}) { background-color: ${label.color}; color: #1b1b1b; }`
      ).join("\n");
      style = createElement("style", "");
      style.textContent = `${css}\n
        .cm-launch, .cm-palette, .cm-panel, .cm-notice { font: 13px system-ui, sans-serif; }
        .cm-launch { position:fixed; right:18px; bottom:18px; z-index:2147483000; border:0; border-radius:18px; padding:9px 15px; background:#28364d; color:white; box-shadow:0 4px 16px #0003; cursor:pointer; }
        .cm-palette { position:fixed; z-index:2147483002; display:flex; gap:5px; padding:6px; max-width: min(96vw, 520px); flex-wrap:wrap; background:var(--dsw-alias-surface-default,#fff); border:1px solid #aaa6; border-radius:10px; box-shadow:0 6px 25px #0003; }
        .cm-palette[hidden], .cm-panel[hidden], .cm-launch[hidden] { display:none; }
        .cm-color { border:1px solid #0002; border-radius:6px; background:var(--cm-color); color:#1b1b1b; padding:6px 8px; cursor:pointer; }
        .cm-panel { position:fixed; top:60px; right:16px; bottom:60px; width:min(360px,calc(100vw - 32px)); z-index:2147483001; overflow:auto; padding:16px; background:var(--dsw-alias-surface-default,#fff); color:var(--dsw-alias-text-primary,#222); border:1px solid #aaa5; border-radius:12px; box-shadow:0 8px 32px #0004; }
        .cm-head,.cm-item-top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .cm-close,.cm-remove,.cm-add-note { border:0; background:transparent; color:inherit; cursor:pointer; font:inherit; }
        .cm-close { font-size:24px; line-height:1; }
        .cm-hint,.cm-empty { opacity:.7; line-height:1.5; }
        .cm-sync-error { padding:8px; border-radius:7px; background:#ff784023; color:inherit; line-height:1.5; }
        .cm-list { display:grid; gap:10px; }
        .cm-item { border:1px solid #aaa5; border-left:5px solid var(--cm-color); border-radius:8px; padding:10px; }
        .cm-tag { background:var(--cm-color); color:var(--cm-on-color,#1b1b1b); border-radius:4px; padding:2px 6px; }
        .cm-quote { margin:9px 0; white-space:pre-wrap; overflow-wrap:anywhere; max-height:110px; overflow:auto; }
        .cm-note { width:100%; box-sizing:border-box; resize:vertical; border:1px solid #aaa8; border-radius:6px; padding:6px; font:inherit; background:transparent; color:inherit; }
        .cm-notice { position:fixed; bottom:60px; right:18px; z-index:2147483003; padding:8px 12px; border-radius:8px; background:#28364d; color:white; }`;
      style.textContent += `
        .cm-palette { align-items:center; flex-wrap:nowrap; gap:5px; padding:6px 8px; border-radius:999px; max-width:calc(100vw - 16px); box-shadow:0 6px 22px #0003; }
        .cm-palette button { position:relative; flex:none; width:28px; height:28px; padding:0; border-radius:50%; cursor:pointer; }
        .cm-color { background:var(--cm-color); border:2px solid #0002; }
        .cm-color:hover,.cm-color:focus-visible { outline:2px solid var(--dsw-alias-text-primary,#222); outline-offset:2px; }
        .cm-pen { display:grid; place-items:center; border:0; background:var(--dsw-alias-text-primary,#252525); color:var(--dsw-alias-surface-default,#fff); }
        .cm-pen svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
        .cm-palette button[data-tooltip]::after { content:attr(data-tooltip); position:absolute; bottom:calc(100% + 12px); left:50%; transform:translateX(-50%); width:max-content; max-width:200px; padding:7px 10px; border-radius:9px; background:#292929; color:#fff; box-shadow:0 3px 12px #0003; font:13px/1.4 system-ui,sans-serif; white-space:normal; text-align:left; opacity:0; visibility:hidden; pointer-events:none; z-index:2147483005; }
        .cm-palette button:hover::after,.cm-palette button:focus-visible::after { opacity:1; visibility:visible; }
        .cm-palette button:first-child::after { left:0; transform:none; }
        .cm-palette button:last-child::after { left:auto; right:0; transform:none; }
        .cm-note-box { position:fixed; z-index:2147483004; width:min(320px,calc(100vw - 16px)); box-sizing:border-box; padding:12px; border:1px solid #aaa5; border-radius:12px; background:var(--dsw-alias-surface-default,#fff); color:var(--dsw-alias-text-primary,#222); box-shadow:0 8px 28px #0004; font:13px system-ui,sans-serif; }
        .cm-note-excerpt { margin:9px 0; padding:8px; border-radius:7px; background:#8882; max-height:90px; overflow:auto; overflow-wrap:anywhere; }
        .cm-note-box .cm-note { min-height:72px; margin-bottom:8px; }
        .cm-save-note { border:0; border-radius:7px; padding:7px 12px; background:var(--dsw-alias-text-primary,#252525); color:var(--dsw-alias-surface-default,#fff); cursor:pointer; }
        .cm-view-switch,.cm-add,.cm-setting-remove { border:1px solid #aaa7; border-radius:7px; padding:5px 8px; background:transparent; color:inherit; cursor:pointer; font:inherit; }
        .cm-view-switch { margin-left:auto; }
        .cm-item-actions { display:flex; align-items:center; gap:10px; margin-left:auto; }
        .cm-add-note { padding:0; white-space:nowrap; }
        .cm-note-done { border:0; background:transparent; color:var(--dsw-alias-text-accent,#3268b0); cursor:pointer; font:inherit; white-space:nowrap; }
        .cm-note-content:empty { display:none; }
        .cm-note-preview { margin-top:9px; padding:8px; border-radius:6px; background:#8882; white-space:pre-wrap; overflow-wrap:anywhere; }
        .cm-note-content .cm-note { margin-top:8px; }
        .cm-note-done { display:block; margin-left:auto; padding:4px 0; }
        .cm-add:disabled { opacity:.45; cursor:default; }
        .cm-settings-heading,.cm-setting-row { display:flex; align-items:center; gap:8px; justify-content:space-between; }
        .cm-settings-heading { margin:14px 0 8px; font-size:13px; }
        .cm-setting-card { display:grid; gap:8px; margin:8px 0 12px; padding:10px; border:1px solid #aaa5; border-radius:9px; }
        .cm-setting-preview { flex:none; width:21px; height:21px; border:1px solid #0002; border-radius:50%; }
        .cm-setting-name,.cm-setting-description,.cm-setting-mode,.cm-hex { box-sizing:border-box; min-width:0; border:1px solid #aaa8; border-radius:6px; padding:6px; background:var(--dsw-alias-surface-default,#fff); color:var(--dsw-alias-text-primary,#222); font:inherit; }
        .cm-mode-row { display:flex; align-items:center; justify-content:space-between; gap:8px; white-space:nowrap; }
        .cm-mode-row .cm-setting-mode { flex:1; width:auto; }
        .cm-setting-name { flex:1; }
        .cm-setting-description,.cm-setting-mode { width:100%; }
        .cm-length { text-align:right; opacity:.6; font-size:11px; }
        .cm-color-choices { display:flex; flex-wrap:wrap; gap:6px; }
        .cm-choice { width:22px; height:22px; border:1px solid #0002; border-radius:50%; cursor:pointer; }
        .cm-choice[aria-pressed="true"] { outline:2px solid var(--dsw-alias-text-primary,#222); outline-offset:2px; }
        .cm-hex-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .cm-hex { width:110px; font-family:ui-monospace,monospace; }
        .cm-note-box[hidden] { display:none; }
        `;
      document.head.appendChild(style);
      highlightStyle = createElement("style", "");
      document.head.appendChild(highlightStyle);
      palette = createElement("div", "cm-palette");
      palette.hidden = true;
      panel = createElement("aside", "cm-panel");
      panel.hidden = true;
      panel.setAttribute("aria-label", "回复标注");
      launch = createElement("button", "cm-launch", "标注");
      launch.type = "button";
      launch.addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) renderPanel(); });
      document.body.append(palette, panel, launch);
      document.addEventListener("selectionchange", onSelection);
      window.addEventListener("scroll", hidePalette, true);
      const timer = setInterval(() => {
        load();
        if (Date.now() - lastClearanceCheck >= 2000) {
          lastClearanceCheck = Date.now();
          void checkClearance();
        }
        const transcript = document.querySelector(TRANSCRIPT);
        if (transcript !== observedTranscript) {
          transcriptObserver?.disconnect();
          observedTranscript = transcript;
          if (transcript) {
            transcriptObserver = new MutationObserver(() => paint());
            transcriptObserver.observe(transcript, { subtree: true, childList: true, characterData: true });
          }
          paint();
        }
      }, 1000);
      load();

      const instance = {
        version: VERSION,
        dispose() {
          if (disposed) return;
          disposed = true;
          clearInterval(timer);
          clearTimeout(syncTimer);
          transcriptObserver?.disconnect();
          document.removeEventListener("selectionchange", onSelection);
          window.removeEventListener("scroll", hidePalette, true);
          for (const name of highlightNames) globalThis.CSS?.highlights?.delete(name);
          closeNoteBox();
          palette.remove(); panel.remove(); launch.remove(); style.remove(); highlightStyle.remove();
          if (globalThis[KEY] === instance) delete globalThis[KEY];
        }
      };
      globalThis[KEY] = instance;
      ctx?.effect?.(() => instance.dispose, "context-mark: annotation UI");
    }

    exports.inject = ["uiSession"];
    exports.apply = apply;
    exports.__test = { subtractSegments, applyMark, activeSessionId, normalizeSettings };
    return module.exports;
  }
});
