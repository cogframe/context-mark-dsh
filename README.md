# Context Mark for DeepSeek Harness

## English

Context Mark lets you highlight passages in AI replies, explain what each highlight means, and request focused revisions. This plugin was tested with DeepSeek Harness desktop `0.2.1-rc.5`.

### Features

- Select words or sentences in an AI reply and apply one color label per passage. Hover over a color to see its meaning. Use the pen button when you want to write a custom note.
- Configure up to nine color labels, their colors and short descriptions, plus a separate pen color. Each label can have no mandatory text requirement, request that content be retained, or request that content be removed.
- Review marks in source-text order, add optional notes, or remove marks. A new selection replaces a mark it covers in the middle; overlap from an edge trims the old mark.
- Use `/mark-revise` with an optional overall instruction to revise the latest completed AI reply. The prompt includes the original reply, relevant marks, and your overall direction.

### Install

Add this local package to the desktop profile's `package.json` dependencies, and include `context-mark-dsh` in `dsh.profile.bundles`. Then run `pnpm install` in that profile directory and restart DeepSeek Harness.

For this workspace, the local dependency is `link:E:/context-mark/context-mark-dsh`. The desktop profile is at `D:/DeepSeekHarness-data/profiles/desktop/`.

### Use

1. Select text in the latest AI reply and choose a color from the floating palette. Click the pen button if the passage needs a custom note.
2. Open **标注** to review marks or add notes. Open **设置** to edit labels and text-generation requirements.
3. Enter `/mark-revise` followed by any overall direction in the same conversation, then send it. For example:

   ```text
   /mark-revise Use fewer paragraphs. Make sections two through four more concrete.
   ```

The retain option asks the model to keep the content while allowing changes needed for clarity, accuracy, or the overall request; it does not lock the exact wording. Unmarked text should stay close to the original unless a targeted or overall request makes a change necessary. After a revision is submitted, the current marks are cleared so the new reply can be annotated as the next version.

### Data and limits

- The interface stores marks in browser `localStorage` and syncs them to the DSH Host under `<DSH_HOME>/context-mark/` so `/mark-revise` can read them.
- The command uses the latest completed AI reply in the active conversation. Marks on older replies are excluded.
- Marks are cleared after revision; this plugin does not yet keep a permanent annotation history.
- Changes to DSH's chat interface or session events may require an adapter update.

### Check

```powershell
npm run check
```

## 中文

Context Mark 可以对 AI 回复中的词句做颜色标注，说明每处标注的含义，并据此提出有针对性的修订要求。本插件已在 DeepSeek Harness 桌面版 `0.2.1-rc.5` 上测试。

### 功能

- 划选 AI 回复中的词句，每处文字只能有一个颜色标签。悬停颜色可查看含义；需要单独写补充说明时使用笔按钮。
- 自定义最多九种颜色标签、颜色和简短说明，另可设置笔按钮的颜色。每个标签的文本生成要求可设为“无强制要求”“保留内容”或“删除内容”。
- 在标注栏按原文顺序查看标注，按需补充说明或移除标注。新选区覆盖旧标注的中间时移除旧标注；从一侧覆盖时缩短旧标注。
- 在同一会话中使用 `/mark-revise`，结合上一条已完成的 AI 回复、对应标注和整体修改要求生成修订版本。

### 安装

在 DSH 桌面配置的 `package.json` 依赖中加入本地包，并在 `dsh.profile.bundles` 中加入 `context-mark-dsh`。随后在该配置目录运行 `pnpm install`，完全退出并重启 DSH。

当前工作区的本地依赖路径为 `link:E:/context-mark/context-mark-dsh`，桌面配置目录为 `D:/DeepSeekHarness-data/profiles/desktop/`。

### 使用

1. 在最新一条 AI 回复中划选文字，点击悬浮颜色按钮；需要自定义补充说明时点笔按钮。
2. 打开“标注”查看或补充说明；打开“设置”调整标签和文本生成要求。
3. 在同一会话的输入框输入 `/mark-revise`，后面可追加整体修改方向，然后发送。例如：

   ```text
   /mark-revise 分段太多；第二、三、四部分再具体一些；少用抽象表达。
   ```

“保留内容”要求模型保留内容，允许它为清晰、准确或满足整体要求作必要调整，并不锁定逐字措辞。未标注部分默认尽量沿用原文；只有局部标注或整体要求确实需要时才修改。提交修订后，当前标注会清除，可对新回复继续标注。

### 数据与限制

- 界面标注保存在浏览器 `localStorage`，并同步到 DSH Host 的 `<DSH_HOME>/context-mark/`，供 `/mark-revise` 读取。
- 命令只修订当前会话最近一条已完成的 AI 回复；更早回复上的标注不会带入。
- 修订后标注会清除；本插件目前尚不保存永久标注历史。
- 如果 DSH 的聊天界面或会话事件格式改变，可能需要更新适配代码。

### 本地检查

```powershell
npm run check
```
