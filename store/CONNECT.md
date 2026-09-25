# App Store Connect 文案

Bundle id：`com.addsum.agenthalo`  
分类：Productivity  
年龄分级：4+  
许可：AGPL-3.0-only，源码：https://github.com/addsumtech/AgentHalo-mas

联系：addsumtech@gmail.com  
隐私政策 URL：https://github.com/addsumtech/AgentHalo-mas/blob/main/docs/PRIVACY.md（建议）  
支持 URL：https://github.com/addsumtech/AgentHalo-mas/blob/main/docs/SUPPORT.md（建议）

## 提交前检查

- 隐私政策 URL 必须在提交前就能公开打开。上面的建议地址要求 `addsumtech/AgentHalo-mas` 是公开仓库，并且 `main` 上已有 `docs/PRIVACY.md`。支持 URL 同理。
- 审核备注和商店文案只链接本仓库。不要链接完整版仓库，它自带第三方角色。
- App 隐私（App Privacy）问卷：开发者不收集任何数据，选「不收集数据」（Data Not Collected）。
- 截图只出现商店版角色，尺寸见文末。
- 按下面「审核备注」里的建议，附一段屏幕录像。

## 中文

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

要接入某个工具，你需要在设置里亲手选择它的配置文件夹（例如 `~/.claude`）。AgentHalo 只在你授权的文件夹里写入 hook 配置和一个 `agenthalo` 小文件夹，hook 配置随时可以在设置里移除。

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

To connect a tool, you choose that tool's config folder in Settings (for example `~/.claude`). AgentHalo writes its hook entries and a small `agenthalo` folder only in folders you authorize, and you can remove the hook entries in Settings at any time.

**Keywords**  
desktop,pet,AI,coding,companion,productivity,agent,developer,terminal,tasks,notification

## 审核备注 / Review Notes

以下英文原样粘贴到 App Store Connect 的 App Review Information → Notes。

---

AgentHalo is a desktop companion for AI coding command-line tools that the user has already installed (for example Claude Code). It has no account, no server and no analytics, and it does not provide an AI service of its own.

HOW TO SEE IT WORK WITHOUT AN AI TOOL

A. Inside the app, no other software needed

1. Launch AgentHalo. The companion appears on the desktop, and AgentHalo adds an icon to the menu bar. On first launch a short welcome guide opens; you can step through it or close it.
2. Right-click the companion, or click the AgentHalo menu bar icon, and choose "Settings…".
3. Click "Desktop companion" in the sidebar. Click any character card; the companion on the desktop switches right away. With Sun Wukong selected, clicking, double-clicking or dragging the companion plays a reaction.
4. On the same page, click "Animation and sound". Each row is one state, labelled with the tool event that triggers it (for example "UserPromptSubmit" for thinking, "PreToolUse" for working, "PermissionRequest" for waiting, "Stop" for done). Click the thumbnail at the left of a row. The companion on the desktop plays that animation once.

B. Simulate a coding tool from Terminal (no AI tool or account needed)

These commands send the same local messages a tool's hook sends. AgentHalo listens on the first free port from 23333 to 23337; on a clean Mac that is 23333.

1. Task starts working. The companion switches to its working animation:

   curl -X POST http://127.0.0.1:23333/state -H 'Content-Type: application/json' -d '{"agent_id":"claude-code","session_id":"review-demo","state":"working","event":"PreToolUse","tool_name":"Edit","session_title":"Review demo"}'

2. Right-click the companion and choose "Open tasks". The list shows "Review demo" as working.

3. Permission request. A bubble with the command and Allow / Deny buttons appears next to the companion. This command waits until you click one of them, then prints the decision:

   curl -X POST http://127.0.0.1:23333/permission -H 'Content-Type: application/json' -d '{"agent_id":"claude-code","session_id":"review-demo","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"echo hello"}}'

4. Task finishes. The companion plays its done animation and sound:

   curl -X POST http://127.0.0.1:23333/state -H 'Content-Type: application/json' -d '{"agent_id":"claude-code","session_id":"review-demo","state":"attention","event":"Stop"}'

C. The attached screen recording shows the full flow with Claude Code: choosing the ~/.claude folder in Settings → Connected apps, starting a task in Terminal, the companion reacting, a permission bubble being answered, and the done animation.

WHY A LOCAL SERVER (network.server)

AgentHalo runs a small HTTP server bound to 127.0.0.1 only, on the first free port from 23333 to 23337. The user's own coding tools run small hook scripts that post task status to it. It is not reachable from the network. The client entitlement is used only for requests the user starts: importing a companion pack from a link they opened, or showing Kimi Code usage after the user saves their own Kimi API key (a request to api.kimi.com with that key).

WHY THE FOLDER PICKER (user-selected files and app-scoped bookmarks)

App Sandbox blocks access to tool config folders such as ~/.claude or ~/.codex. In Settings → Connected apps, the user clicks "Choose folder" for a tool. The system open panel starts at that tool's folder (hidden folders shown), and AgentHalo accepts only that folder or a folder that contains it. AgentHalo saves a security-scoped bookmark in authorized-dirs.json inside its own container and uses it only to add or remove its hook entries in that tool's config folder, to read the tool's session files there, and to keep a small "agenthalo" subfolder there. That subfolder holds runtime.json (the local port and process id, removed on quit) so the hooks, which run outside the sandbox, can find the app without reading its container; for Codex, the auto-start setting; and for Claude Code, short-lived records of running tasks that the hook writes so the app can show them again after a restart. Canceling the panel writes nothing. Outside its own container, AgentHalo can reach only the folders the user picks. Removing a tool in Settings → Connected apps removes the hook entries again.

NO APPLE EVENTS

This build does not send Apple Events and does not control other apps.

WHAT DATA THE APP RECEIVES

Hooks send the task state, event name, working directory, tool name, and a task title taken from the first line of the user's prompt (or the tool's session title). When a task finishes, the hook adds a short excerpt (at most 2,400 characters) of the assistant's last reply so the companion can choose a reaction. Permission requests include the tool input (for example the command) so the bubble can show it before the user decides. For Claude Code, AgentHalo also reads the end of the session file in the authorized folder to confirm a task has finished. All of this is processed on the Mac. Nothing is sent to us, to Apple, or to any analytics service.

WHAT THIS BUILD DOES NOT INCLUDE

Remote and messaging features are not included: Telegram, Feishu/Lark, Slack, Discord, remote SSH, WSL and LAN preview. The store build does not install a VS Code extension and does not ship a browser extension. It has no self-updater; updates come only from the Mac App Store.

CHARACTERS

The built-in characters are 17 original companions created for AgentHalo, plus Sun Wukong from the 16th-century novel Journey to the West, in original artwork. No real people and no third-party characters are included. Users can import their own character packs; they stay in the app's container.

SOURCE CODE

AgentHalo is licensed under AGPL-3.0-only. Source for this build: https://github.com/addsumtech/AgentHalo-mas

Contact: addsumtech@gmail.com

---

屏幕录像（C 项）请在 App Review Information 里作为附件上传，时长控制在 1–2 分钟，需要依次拍到：

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
