# AgentHalo Support

**Contact:** [addsumtech@gmail.com](mailto:addsumtech@gmail.com) · [GitHub Issues](https://github.com/addsumtech/AgentHalo/issues)
Please write in English or 简体中文.

When something is wrong, the fastest path is usually Settings → Agents → the **Doctor** panel, which checks the local connection and each installed integration and tells you which step failed.

## What AgentHalo is

A desktop companion for macOS that shows what your AI coding tools are doing. It does not provide an AI service of its own. It watches tools you have already installed and reacts to their progress.

## Getting started

1. Open Settings → **Agents**.
2. Connect the tools you use. AgentHalo installs a small hook into that tool's own configuration directory, for example `~/.claude` or `~/.codex`.
3. Restart that tool so it picks up the hook.
4. Run something. Your companion should switch to a working animation.

For web chats on Claude, ChatGPT, or Gemini, install the **AgentHalo Web Bridge** browser extension from the Agents tab. The desktop app must be running; the extension finds it automatically on `127.0.0.1`.

## Common problems

**The companion never reacts.**
The tool's hook is probably not installed or the tool was not restarted. Open the Doctor panel; it reports the state of each hook. If the Doctor says the local server is not reachable, another program may be holding all of ports 23333 through 23337.

**The browser extension shows nothing.**
Refresh any chat tabs that were already open before you installed it. Content scripts do not attach to pages loaded earlier. Also confirm the desktop app is running, since the extension talks to it over localhost.

**A task card shows a folder name instead of a task name.**
That means nothing has named that session yet, so AgentHalo falls back to the workspace folder. Cards in this state are marked with a folder icon. The real name appears once the tool assigns one.

**A task is stuck in "working" after it finished.**
Some tools do not emit an end event when their window closes. AgentHalo retires idle sessions after the timeout set in Settings. You can also clear sessions manually from the dashboard.

**No sound.**
AgentHalo follows the system: it stays quiet when your Mac is muted or the output volume is zero. Check the volume slider in Settings → General as well.

**The companion is in the way.**
Drag it anywhere. Settings → General adjusts size, and Do Not Disturb silences reactions without quitting.

## Uninstalling

1. Settings → Agents → remove each connected tool. This deletes the hooks AgentHalo added to their configuration directories.
2. Remove the browser extension from your browser.
3. Quit AgentHalo and move it to the Trash.
4. To remove local data as well, delete `~/Library/Application Support/AgentHalo/` and `~/.clawd/`.

## Privacy

See the [privacy policy](PRIVACY.md). In short: no account, no server, no analytics, and the browser extension never reads your conversations.

## Reporting a bug

[Open a GitHub Issue](https://github.com/addsumtech/AgentHalo/issues/new) with:

- what you did and what happened instead
- your macOS version and AgentHalo version, both shown in Settings → About
- which AI tool was involved

If you can, attach `~/Library/Application Support/AgentHalo/session-debug.log`. It contains event names and session identifiers, not your conversations, but please skim it before sending.

---

# AgentHalo 支持

**联系方式：** [addsumtech@gmail.com](mailto:addsumtech@gmail.com) · [GitHub Issues](https://github.com/addsumtech/AgentHalo/issues)
请用简体中文或英文。

出问题时最快的路径通常是 设置 → 应用 → **体检**面板，它会检查本地连接和每个已安装的集成，并告诉你是哪一步失败了。

## AgentHalo 是什么

一个 macOS 桌面伙伴，显示你的 AI 编程工具正在做什么。它本身不提供 AI 服务，而是观察你已经装好的工具，并对它们的进展做出反应。

## 开始使用

1. 打开 设置 → **应用**。
2. 连接你在用的工具。AgentHalo 会往那个工具自己的配置目录里装一个小 hook，例如 `~/.claude` 或 `~/.codex`。
3. 重启那个工具，让它加载 hook。
4. 跑点东西。桌宠应该切换到工作中的动画。

如果你用 Claude、ChatGPT 或 Gemini 的网页版，在应用标签页里安装 **AgentHalo Web Bridge** 浏览器扩展。桌面应用需要处于运行状态；扩展会在 `127.0.0.1` 上自动找到它。

## 常见问题

**桌宠完全没反应。**
多半是工具的 hook 没装上，或者工具没重启。打开体检面板，它会报告每个 hook 的状态。如果体检说本地服务不可达，可能是别的程序占满了 23333 到 23337 这几个端口。

**浏览器扩展没动静。**
刷新一下装扩展之前就已经打开的聊天标签页。内容脚本不会附加到更早加载的页面上。另外确认桌面应用在运行，因为扩展是通过 localhost 跟它通信的。

**任务卡片显示的是文件夹名，不是任务名。**
这说明还没有东西给这个会话命名，所以 AgentHalo 回退到了工作区文件夹。这种状态的卡片会带一个文件夹图标。等工具给出真实名称后就会替换。

**任务已经结束了，卡片还卡在"工作中"。**
有些工具在窗口关闭时不会发出结束事件。AgentHalo 会在设置里指定的超时后退休空闲会话。你也可以在仪表盘里手动清理。

**没有声音。**
AgentHalo 跟随系统：Mac 静音或输出音量为零时它会保持安静。另外检查一下 设置 → 通用 里的音量滑块。

**桌宠挡路了。**
拖到任何地方都行。设置 → 通用 可以调大小，勿扰模式可以在不退出的前提下让它安静。

## 卸载

1. 设置 → 应用 → 逐个移除已连接的工具。这会删掉 AgentHalo 装进它们配置目录的 hook。
2. 在浏览器里移除扩展。
3. 退出 AgentHalo 并移到废纸篓。
4. 如果连本地数据一起清掉，删除 `~/Library/Application Support/AgentHalo/` 和 `~/.clawd/`。

## 隐私

见[隐私政策](PRIVACY.md)。一句话：没有账号、没有服务器、没有统计，浏览器扩展也从不读你的对话。

## 报告问题

请[开一个 GitHub Issue](https://github.com/addsumtech/AgentHalo/issues/new)，并附上：

- 你做了什么，以及实际发生了什么
- 你的 macOS 版本和 AgentHalo 版本，两者都在 设置 → 关于 里
- 涉及哪个 AI 工具

方便的话附上 `~/Library/Application Support/AgentHalo/session-debug.log`。它记录的是事件名和会话标识，不是你的对话内容，但发送前还是请你先扫一眼。
