# App Store Connect 文案

Bundle id：`com.addsum.agenthalo`  
分类：Productivity  
年龄分级：4+  
价格：中国大陆免费，其他地区 USD 1.99 买断。价格表基准国家/地区选美国（其他地区由 Apple 自动换算），再手动管理中国大陆，价格选「免费」。没有应用内购买和订阅  
许可：AGPL-3.0-only，源码：https://github.com/addsumtech/AgentHalo-mas

联系：addsumtech@gmail.com  
隐私政策 URL：https://github.com/addsumtech/AgentHalo-mas/blob/main/docs/PRIVACY.md（建议）  
支持 URL：https://github.com/addsumtech/AgentHalo-mas/blob/main/docs/SUPPORT.md（建议）

## 提交前检查

- 收费 App 要先在 App Store Connect 的「协议、税务和银行业务」里签好「付费 App」协议，并填完银行账户和税务信息，状态变成「有效」后价格才会生效。中国大陆免费不影响这一条：其他地区收费就必须签。
- 中国大陆的价格如果在手动管理里选不到「免费」，先别提交，重新规划定价方式。
- 上架中国大陆可能需要 ICP 备案号；没有备案就先不在销售范围里勾选中国大陆。
- 隐私政策 URL 必须在提交前就能公开打开。上面的建议地址要求 `addsumtech/AgentHalo-mas` 是公开仓库，并且 `main` 上已有 `docs/PRIVACY.md`。支持 URL 同理。
- 审核备注和商店文案只链接本仓库。不要链接完整版仓库，它自带第三方角色。
- App 隐私（App Privacy）问卷：开发者不收集任何数据，选「不收集数据」（Data Not Collected）。
- 截图只出现商店版角色，尺寸见文末。
- 屏幕录像不是必需的：审核备注里的 A、B 两条路径不装任何 AI 工具就能验证全部功能。只有审核回复说无法测试时，再按文末「屏幕录像（备用）」录一段，在回复里附上。

## 中文

以下名称、副标题、描述和关键词原样粘贴；App Store 不渲染 Markdown，所以正文里不用反引号等标记。

**名称**  
AgentHalo

**副标题**  
桌面上的 AI 任务伴侣

**描述**

AgentHalo 是一只安静待在桌面上的小伙伴。你的本地 AI 编程工具开始干活、思考、或等你确认时，它会跟着动；事情做完了，它再轻轻提醒你一声。

· 任务列表：看到哪些任务在工作、哪些在等你。
· 权限气泡：工具请求执行命令时，桌宠旁边弹出气泡，显示它要做什么，由你允许或拒绝。
· 18 个内置角色：17 个原创桌宠（光环、豆芽、柿子、墨点、月牙等），以及孙悟空。每个角色都有自己的动画和音效。你也可以导入自己的角色包。

隐私：任务状态只在你的 Mac 上处理。为了显示任务和气泡，AgentHalo 会收到任务标题、工具名、工作目录，以及完成时回复的简短摘录；这些内容不会存到 Mac 以外，也不会上传给苹果或我们。没有账号，没有统计。本机状态服务只监听 127.0.0.1。

要接入某个工具，你需要在设置里亲手选择它的配置文件夹（例如 ~/.claude）。AgentHalo 只在你授权的文件夹里写入 hook 配置和一个 agenthalo 小文件夹，在设置里断开连接时两者都会移除。

**关键词**  
桌宠,AI,编程,效率,伴侣,任务,智能体,开发者,终端,提醒,命令行

## English

**Name**  
AgentHalo

**Subtitle**  
A quiet companion for AI tasks

**Description**

AgentHalo sits on your Mac desktop and follows your local AI coding tools. When a task is thinking, working, or waiting for you, the companion shows it. When the work is done, it gives you a small nudge.

· Task list: see which tasks are working and which are waiting for you.
· Permission bubbles: when a tool asks to run a command, a bubble next to the companion shows what it wants to do, and you allow or deny it.
· 18 built-in characters: 17 original companions (Halo, Sprout, Persimmon, Ink, Crescent, and more) plus Sun Wukong, each with its own animations and sounds. You can also import your own character packs.

Privacy: task status is processed only on your Mac. To show tasks and bubbles, AgentHalo receives task titles, tool names, working folders, and a short excerpt of the final reply when a task finishes. None of it is stored off your Mac or uploaded to Apple or to us. There is no account and no analytics. The local status server listens on 127.0.0.1 only.

To connect a tool, you choose that tool's config folder in Settings (for example ~/.claude). AgentHalo writes its hook entries and a small agenthalo folder only in folders you authorize, and disconnecting the tool in Settings removes both.

**Keywords**  
desktop,pet,AI,coding,companion,productivity,agent,developer,terminal,tasks,notification

## 审核备注 / Review Notes

以下英文原样粘贴到 App Store Connect 的 App Review Information → Notes。备注栏最多 4000 个字符，这段控制在 4000 以内，改动后请重新数一下。

---

AgentHalo is a desktop companion for AI coding tools the user already has, such as Claude Code. It has no account, server or analytics, and provides no AI service of its own.

A. INSIDE THE APP (nothing else needed)

1. Launch AgentHalo. The companion appears on the desktop and an icon in the menu bar; a short welcome guide opens on first launch.
2. Right-click the companion (or click the menu bar icon) and choose "Settings…".
3. "Desktop companion": click any character card and the companion switches. Sun Wukong reacts to clicks and drags.
4. "Animation and sound": click a row's thumbnail and the companion plays that state once.

B. SIMULATE A CODING TOOL FROM TERMINAL (no AI tool or account needed)

These commands send the same local messages a tool's hook sends. AgentHalo listens on the first free port from 23333 to 23337; on a clean Mac that is 23333.

1. Working:

   curl -X POST http://127.0.0.1:23333/state -H 'Content-Type: application/json' -d '{"agent_id":"claude-code","session_id":"review-demo","state":"working","event":"PreToolUse","tool_name":"Edit","session_title":"Review demo"}'

2. Right-click the companion and choose "Open tasks": "Review demo" is listed as working.

3. Permission bubble. The command waits until you click Allow or Deny, then prints the decision:

   curl -X POST http://127.0.0.1:23333/permission -H 'Content-Type: application/json' -d '{"agent_id":"claude-code","session_id":"review-demo","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"echo hello"}}'

4. Done animation and sound:

   curl -X POST http://127.0.0.1:23333/state -H 'Content-Type: application/json' -d '{"agent_id":"claude-code","session_id":"review-demo","state":"attention","event":"Stop"}'

C. WITH CLAUDE CODE INSTALLED

In Settings → Connected apps, click "Choose folder" next to Claude Code and select ~/.claude. Run claude in Terminal and ask it to edit a file: the companion works, a permission bubble appears, and it celebrates when the task ends. "Disconnect" removes everything AgentHalo added.

ENTITLEMENTS

- network.server: a small HTTP server bound to 127.0.0.1 only (first free port 23333-23337). The user's coding tools post task status to it through hook scripts. It is not reachable from the network.
- network.client: only for requests the user starts: importing a companion pack from a link they opened, or Kimi Code usage after the user saves their own Kimi API key.
- user-selected files and app-scoped bookmarks: App Sandbox blocks tool folders such as ~/.claude. The user chooses the folder in Settings; AgentHalo accepts only that folder or its parent and keeps a bookmark in its container. It uses the folder to add or remove its hook entries, read the tool's session files, and keep a small "agenthalo" subfolder (the local port for the hooks, the Codex auto-start setting, and short-lived records of running Claude Code tasks). Disconnecting removes both.

DATA

Hooks send task state, event name, working directory, tool name, a task title, a short excerpt of the final reply, and a permission request's tool input. Everything is processed on the Mac; nothing is sent to us, to Apple, or to any analytics service. The app does not send Apple Events or control other apps.

NOT INCLUDED

No remote or messaging features (Telegram, Feishu/Lark, Slack, Discord, remote SSH, WSL, LAN preview), no VS Code or browser extension, no self-updater.

CHARACTERS

17 original companions created for AgentHalo, plus Sun Wukong from the 16th-century novel Journey to the West, in original artwork. No real people or third-party characters. Imported character packs stay in the app's container.

SOURCE CODE: AGPL-3.0-only, https://github.com/addsumtech/AgentHalo-mas
Contact: addsumtech@gmail.com

---

### 屏幕录像（备用）

默认不用录。如果审核回复说无法测试，再录一段 1–2 分钟的录像，在 Resolution Center 的回复里附上，依次拍到：

1. 设置 → 连接应用 → Claude Code → 选择文件夹，系统面板里选中 `~/.claude` 并授权；
2. 在终端里启动 Claude Code 并提一个会改文件或运行命令的问题，桌宠切到工作中，任务列表里出现这个任务；
3. 权限气泡出现，点「允许」；
4. 任务完成，桌宠播放完成动画；
5. 回到设置，关闭该工具的连接，说明 hook 会被移除。

录像里不要出现完整版角色或私人对话内容。

## 截图清单

Mac App Store 截图必须是 16:10，可用尺寸：1280×800、1440×900、2560×1600、2880×1800。每个语言 1–10 张。`store/screenshots/*.png` 是 2880×1800，由同名 HTML 以 1440×900 视口、deviceScaleFactor 2 渲染而成。HTML 用相对路径引用 `agenthalo/` 里的样式和素材，在任何检出目录都能直接渲染。01–03 是在 Mac 上用系统字体渲染的；04、05 是在 Linux 上用 Inter + Noto Sans SC 代替 SF / 苹方渲染的，观感接近。想要完全一致，就在 Mac 上把 04、05 重新渲染一次。

只用商店版角色出镜（优先光环 / 孙悟空）：

1. 桌宠在桌面上，任务列表打开（`01-desktop`）
2. 设置 → 连接应用，显示「选择文件夹」（`02-choose-folder`）
3. 文件夹授权后的已接入状态（`03-authorized`）
4. 桌面伙伴页，只出现 17 个原创角色和孙悟空（`04-characters`）
5. 关于页 / 隐私说明（`05-about`）

不要让完整版角色（皮卡丘、马里奥、路飞等）或任何真实人物形象出镜。改了 HTML 之后重新渲染对应 PNG，并检查尺寸仍是 2880×1800。
