# AgentHalo Privacy Policy

**Last updated:** 2026-09-19
**Effective date:** 2026-09-13
**Operator:** Addsum
**Privacy contact:** [addsumtech@gmail.com](mailto:addsumtech@gmail.com)

This policy covers the AgentHalo desktop app for macOS and the AgentHalo Web Bridge browser extension. It describes the behaviour of the shipped build; every statement below was checked against the source code rather than against intent.

## The short version

AgentHalo has no account, no server, and no analytics. It does not collect, transmit, or sell personal information. Everything it knows about your work stays on your Mac.

Two things leave your machine, and only when you ask for them:

- If you save a Kimi API key and turn on quota display, AgentHalo calls `api.kimi.com` with that key to read your own usage numbers.
- If you press the button in Settings that checks the browser extension version, AgentHalo asks GitHub for the public release list. That request carries no identifier.

Opening a link, or importing a companion character from a URL you supplied, also uses the network, because you asked it to.

## What AgentHalo does not do

- No telemetry, no analytics, no usage statistics, no crash reporting. There is no such SDK in the codebase.
- No automatic update check. The updater is a stub that reports "manual only" and never contacts a server.
- No advertising, no advertising identifier, no data broker, no sale or sharing of data.
- No account, no sign-in, no cloud sync.
- No reading of your conversations. See the browser extension section for exactly what is and is not read.

## What stays on your Mac

AgentHalo writes the following to your own disk. None of it is uploaded anywhere.

| What | Where | Notes |
| --- | --- | --- |
| Preferences | `~/Library/Application Support/AgentHalo/agenthalo-prefs.json` | Companion position and size, theme, which integrations are on, session display names you typed |
| Diagnostic logs | `~/Library/Application Support/AgentHalo/*.log` | Session, permission, focus and update logs. Operational metadata such as event names and session identifiers. Rotated at about 1 MB |
| Activity footprints | `~/.clawd/recap-v1/` | Daily counts only. Keys are HMAC-hashed. No prompts, no replies, no file paths, no project names. You can turn recording off and delete the data in Settings |
| Runtime discovery | `~/.clawd/runtime.json` | The local port and process id, written with `0600` permissions so your agent hooks can find the app |
| Kimi API key | `~/.clawd/kimi-code-quota-credential.json` | Encrypted with Electron `safeStorage`, which is backed by the macOS Keychain. If the platform cannot provide real encryption, AgentHalo refuses to store the key rather than writing it in the clear |
| Theme cache | `~/Library/Application Support/AgentHalo/theme-cache/` | Sanitised copies of imported character artwork |

Live session details, including the working directory and the title of the current task, are held in memory while the app runs and are discarded when it quits.

## The local connection AgentHalo listens on

AgentHalo runs a small HTTP server bound to `127.0.0.1` on the first free port between 23333 and 23337. It is reachable only from your own machine; it is not exposed to your network or the internet.

Your locally installed AI coding tools post their status to it through hook scripts that AgentHalo installs into those tools' own configuration directories, such as `~/.claude` and `~/.codex`. A status message carries the agent name, a session id, the state, the event name, the working directory, the task title, and the name of the tool being run. A completion may include a short excerpt of the assistant's last message, capped at 2400 characters, which is used only to decide which animation to play and is never written to disk or sent anywhere.

There is no authentication beyond the localhost binding. Any program already running as you could post to this port. We consider that the same trust boundary as your own shell.

## Optional integrations

The desktop build ships with these turned off, and Settings currently blocks turning them on: Telegram, Slack, Feishu/Lark, Discord Rich Presence, remote SSH, and LAN preview. Their code is still in the repository for people who build their own copy. If you build a copy and enable one, that integration sends data to the service you configured, under that service's own privacy policy, and this policy does not cover it.

## The browser extension

The AgentHalo Web Bridge extension runs on `claude.ai`, `chatgpt.com`, `chat.openai.com`, and `gemini.google.com`. Its job is to tell the desktop app whether a reply is currently being generated, so the companion can react.

**It does not read your conversations.** It looks at a small number of interface signals that indicate generation is in progress: whether a streaming attribute is set, whether a stop button is on screen, and which icon the send button is showing. It also reads the browser tab title and the conversation URL.

What it sends, and it sends this only to `127.0.0.1` on the AgentHalo port:

- which site and conversation the tab is on, as a URL
- a generated session id for that tab
- the state, meaning thinking, working, waiting, or idle
- the page title, truncated to 120 characters, used as the task label

Message text, your prompts, model replies, attachments, and anything you type are never read and never transmitted.

The extension stores its per-tab session bookkeeping in `chrome.storage`. Its `host_permissions` are limited to `http://127.0.0.1/*` and `http://localhost/*`, which is the only destination it can reach. The `tabs` permission is used to notice when a tab closes or navigates away so the matching task can be closed.

## Identifiers

AgentHalo generates a few random values for local bookkeeping: a credential id next to your encrypted Kimi key, a session token per browser tab, and hashed keys inside the footprint database. None of them leaves your machine. There is no install id, device fingerprint, or advertising identifier sent anywhere.

## Children

AgentHalo is a developer tool and is not directed at children under 13. It does not knowingly collect information from them.

## Your choices

Because nothing is collected, there is no account to close and no data for us to delete on your behalf. You control everything directly:

- Turn footprint recording off, or delete the recorded data, in Settings.
- Remove the Kimi key in Settings to delete the encrypted credential file.
- Remove an integration in Settings to uninstall the hook it added to that tool's configuration.
- Uninstall the browser extension to stop all web page observation.
- Delete `~/Library/Application Support/AgentHalo/` and `~/.clawd/` to remove everything AgentHalo has written.

## Changes

If AgentHalo's data handling changes, this page and the effective date above will be updated before the change ships.

## Contact

Privacy questions: [addsumtech@gmail.com](mailto:addsumtech@gmail.com).

---

# AgentHalo 隐私政策

**最后更新：** 2026-09-19
**生效日期：** 2026-09-13
**运营主体：** Addsum
**隐私联系：** [addsumtech@gmail.com](mailto:addsumtech@gmail.com)

本政策适用于 macOS 桌面应用 AgentHalo 与 AgentHalo Web Bridge 浏览器扩展。以下每一条都是对照源码核对过的，不是对设计意图的描述。

## 一句话版本

AgentHalo 没有账号、没有服务器、没有统计。它不收集、不传输、不出售个人信息。它知道的关于你工作的一切，都留在你自己的 Mac 上。

只有两件事会离开你的机器，而且都需要你主动发起：

- 如果你保存了 Kimi API key 并打开额度显示，AgentHalo 会带着这个 key 调用 `api.kimi.com`，读取你自己的用量数字。
- 如果你在设置里点了检查浏览器扩展版本，AgentHalo 会向 GitHub 请求公开的发布列表。这个请求不携带任何标识。

打开链接、或从你自己给的 URL 导入角色，同样会用到网络，因为那是你要求的。

## AgentHalo 不做的事

- 没有遥测、没有分析、没有使用统计、没有崩溃上报。代码里根本没有这类 SDK。
- 没有自动更新检查。更新器是一个桩，只返回"仅手动"，从不联网。
- 没有广告、没有广告标识符、没有数据经纪、不出售也不共享数据。
- 没有账号、没有登录、没有云同步。
- 不读你的对话内容。具体读了什么、没读什么，见下面浏览器扩展一节。

## 留在你 Mac 上的东西

以下内容只写到你自己的磁盘，不会上传到任何地方。

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| 偏好设置 | `~/Library/Application Support/AgentHalo/agenthalo-prefs.json` | 桌宠位置和大小、主题、哪些集成开着、你自己起的会话名 |
| 诊断日志 | `~/Library/Application Support/AgentHalo/*.log` | 会话、权限、聚焦、更新日志。记录事件名和会话标识这类运行元数据。约 1 MB 轮转 |
| 活动足迹 | `~/.clawd/recap-v1/` | 只有按天的计数，键经过 HMAC 哈希。不含提示词、不含回复、不含文件路径、不含项目名。可以在设置里关闭记录并删除数据 |
| 运行时发现 | `~/.clawd/runtime.json` | 本机端口和进程号，以 `0600` 权限写入，供你的 agent hook 找到应用 |
| Kimi API key | `~/.clawd/kimi-code-quota-credential.json` | 用 Electron `safeStorage` 加密，背后是 macOS 钥匙串。如果平台无法提供真正的加密，AgentHalo 宁可拒绝保存，也不会明文落盘 |
| 主题缓存 | `~/Library/Application Support/AgentHalo/theme-cache/` | 导入角色素材的净化副本 |

实时会话信息（包括工作目录和当前任务标题）只在应用运行期间存在于内存中，退出即丢弃。

## AgentHalo 监听的本地连接

AgentHalo 会在 `127.0.0.1` 上启动一个小的 HTTP 服务，占用 23333 到 23337 之间第一个空闲端口。它只能从本机访问，不向局域网或互联网暴露。

你本机安装的 AI 编程工具通过 hook 脚本把状态发到这里，这些脚本由 AgentHalo 安装到那些工具自己的配置目录，例如 `~/.claude` 和 `~/.codex`。一条状态消息包含 agent 名称、会话 id、状态、事件名、工作目录、任务标题，以及正在运行的工具名。任务完成时可能附带助手最后一条消息的短摘录，上限 2400 字符，只用来决定播哪个动画，既不落盘也不外发。

除了绑定在 localhost 之外没有额外鉴权。任何已经以你的身份运行的程序都能往这个端口发消息。我们认为这和你自己的 shell 是同一个信任边界。

## 可选集成

桌面版出厂就关闭了这些集成，而且设置里当前禁止开启：Telegram、Slack、飞书/Lark、Discord Rich Presence、远程 SSH、局域网预览。它们的代码仍保留在仓库里，供自行构建的人使用。如果你自己构建并启用了某一项，该集成会把数据发给你配置的服务，适用那个服务自己的隐私政策，本政策不覆盖。

## 浏览器扩展

AgentHalo Web Bridge 扩展运行在 `claude.ai`、`chatgpt.com`、`chat.openai.com`、`gemini.google.com` 上。它的职责是告诉桌面应用当前是否正在生成回复，好让桌宠做出反应。

**它不读你的对话。** 它看的是少数几个表示"正在生成"的界面信号：流式属性有没有置位、停止按钮在不在屏幕上、发送按钮显示的是哪个图标。另外它会读浏览器标签标题和会话 URL。

它发送的内容，而且只发到 `127.0.0.1` 上的 AgentHalo 端口：

- 标签页所在的站点和会话，以 URL 形式
- 为该标签生成的会话 id
- 状态，即思考中、工作中、等待中或空闲
- 页面标题，截断到 120 字符，用作任务标签

消息正文、你的提示词、模型回复、附件，以及你输入的任何内容，都不会被读取，也不会被传输。

扩展在 `chrome.storage` 里保存每个标签的会话记账。它的 `host_permissions` 只有 `http://127.0.0.1/*` 和 `http://localhost/*`，这也是它唯一能访问的目的地。`tabs` 权限用于察觉标签关闭或跳走，好把对应任务关掉。

## 标识符

AgentHalo 会生成少量随机值用于本地记账：加密 Kimi key 旁边的凭据 id、每个浏览器标签的会话令牌、足迹数据库里的哈希键。它们都不离开你的机器。没有安装 id、没有设备指纹、没有广告标识符被发往任何地方。

## 儿童

AgentHalo 是开发者工具，不面向 13 岁以下儿童，也不会有意收集他们的信息。

## 你的选择

因为什么都没被收集，所以没有账号需要注销，也没有数据需要我们代你删除。一切都由你直接控制：

- 在设置里关闭足迹记录，或删除已记录的数据。
- 在设置里移除 Kimi key，即删除那个加密凭据文件。
- 在设置里移除某个集成，即卸载它装到那个工具配置里的 hook。
- 卸载浏览器扩展，即停止全部网页观察。
- 删除 `~/Library/Application Support/AgentHalo/` 和 `~/.clawd/`，即清除 AgentHalo 写过的一切。

## Mac App Store 补充

商店版运行在 App Sandbox 里。它不会默认写入 `~/.claude`、`~/.codex` 或其他家目录配置。只有你在设置里用系统文件夹选择器授权某个工具的配置目录后，AgentHalo 才会用安全范围书签在该目录写入 hook。取消选择则什么都不写。

本机状态服务仍只监听 `127.0.0.1`。商店包不写 Chrome 偏好，也不提供 SSH / WSL 部署。

## 变更

如果 AgentHalo 的数据处理方式发生变化，本页面和上方的生效日期会在变化发布之前更新。

## 联系方式

隐私相关问题：[addsumtech@gmail.com](mailto:addsumtech@gmail.com)。
