# App Store Connect 文案

Bundle id：`com.addsum.agenthalo`  
分类：Productivity  
年龄分级：4+  
许可：AGPL-3.0-only（源码见本仓库；完整版另见 https://github.com/addsumtech/AgentHalo）

联系：addsumtech@gmail.com  
隐私政策：随包 `docs/PRIVACY.md`，上线后挂到公开 URL  
支持：`docs/SUPPORT.md` / GitHub Issues（完整版仓库）或 addsumtech@gmail.com

## 中文

**名称**  
AgentHalo

**副标题**  
桌面上的 AI 任务伴侣

**描述**

AgentHalo 是一只安静待在桌面上的小伙伴。当你的本地 AI 编程工具开始干活、想事情、或等你点头时，它会跟着动；事情做完了，它再轻轻喊你一声。

商店版只内置无版权争议的角色：原创「光环」，以及乔布斯、巴菲特、芒格、孙悟空。你也可以自己导入角色包。

它不读你的对话，也不把任务内容上传到苹果或我们的服务器。本机状态口只绑在 127.0.0.1。要让某个工具的桌宠动起来，你需要在设置里亲手选出那个工具的配置文件夹（例如 `~/.claude`）。AgentHalo 只会在你授权的目录里写入 hook。

浏览器扩展请从 Chrome 网上应用店或 GitHub 完整版安装，商店包不会改 Chrome 配置。

**关键词**  
桌宠,AI,编程,Claude,Codex,Cursor,效率,伴侣,任务

## English

**Name**  
AgentHalo

**Subtitle**  
A quiet companion for AI tasks

**Description**

AgentHalo sits on your Mac desktop and moves with your local AI coding tools. When a task is thinking, working, or waiting for you, the companion shows it. When the work is done, it gives you a small nudge.

The store build ships only license-safe characters: the original Halo companion, plus Jobs, Buffett, Munger, and Sun Wukong. You can import your own character packs.

AgentHalo does not read your conversations and does not upload task content to Apple or to us. The local status server binds to 127.0.0.1 only. To connect a tool, you choose that tool’s config folder in Settings (for example `~/.claude`). Hooks are written only in folders you authorize.

The browser extension is installed from the Chrome Web Store or the GitHub full build. This Mac App Store app does not rewrite Chrome preferences.

**Keywords**  
desktop,pet,AI,coding,Claude,Codex,Cursor,companion,productivity

## 审核备注 / Review Notes

AgentHalo is a local desktop companion for AI coding CLIs. It does not host user accounts and does not send prompts or replies to our servers.

Why localhost: the companion receives hook events from tools such as Claude Code and Codex on 127.0.0.1. That port never leaves the Mac.

Why the folder picker: App Sandbox blocks writes to `~/.claude`, `~/.codex`, and similar directories. The user must choose the config folder. We persist a security-scoped bookmark and write hooks only there. Canceling the picker writes nothing.

We do not read conversation text. Hooks report task state (idle / thinking / working / done).

Built-in characters are original or public-figure / folklore depictions. Third-party characters are not bundled. Users may import their own ZIP packs.

SSH tunnels, WSL deploy, and writing Chrome preferences are removed or hidden in this store build.

Source offer: this repository is the store source tree (AGPL-3.0). The full non-sandbox build is https://github.com/addsumtech/AgentHalo.

## 截图清单

拍 6.5" Mac 截图，只用商店角色（优先 Halo / 孙悟空）：

1. 桌宠在桌面上，任务列表打开
2. 设置 → 连接应用，显示「选择文件夹」
3. 文件夹授权后的已接入状态
4. 角色页，只出现商店角色
5. 关于页 / 隐私说明

不要用皮卡丘、马里奥、路飞等完整版角色出镜。
