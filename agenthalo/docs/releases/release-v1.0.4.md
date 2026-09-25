# AgentHalo 1.0.4

修复 Cursor 空会话以项目文件夹名出现在任务列表、一直显示“等待中”的问题。

## 修复内容

- 仅创建或打开 Cursor 会话时，不再创建任务条目；收到实际提问、思考或工具活动后才显示。
- 保留空会话的来源识别，避免稍后的正常活动被误判为其他任务的子 agent。
- 延迟到达的会话开始通知不再把正在执行的任务重置为等待。
- 保留现有 Cursor 子 agent 过滤，其他应用的会话显示规则不变。

## 安装或升级

本文件属于 Mac App Store 源码树。用户从 App Store 更新；开发构建使用 `npm run build:mas`。

商店版内置 17 个原创角色和孙悟空，不包含浏览器扩展、VS Code 扩展和已下线的远程功能（Telegram、飞书、Slack、Discord、远程 SSH、WSL、局域网预览）。

## 许可证

AGPL-3.0-only。基于 [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk) 开发，保留上游版权和许可证。
