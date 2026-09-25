# AgentHalo (Mac App Store)

This tree is the **store-only** build. It is not the GitHub / `npx agenthalo` full app.

- Bundle id: `com.addsum.agenthalo`
- Sandbox: users must pick each tool’s config folder in Settings before hooks are written. AgentHalo keeps a security-scoped bookmark for that folder and writes only its hook entries there.
- Local status server: `127.0.0.1` only, first free port from 23333 to 23337.
- Built-in characters: 17 original companions plus Sun Wukong. No likenesses of real people, living or deceased, and no third-party characters.
- Not in the store build: Apple Events, the VS Code extension, the browser extension, the retired remote features (Telegram, Feishu/Lark, Slack, Discord, remote SSH, WSL, LAN preview) and the self-updater. Updates come only from the Mac App Store.
- App data lives in `~/Library/Containers/com.addsum.agenthalo/Data/`.
- License: AGPL-3.0-only

The unrestricted desktop build stays in [addsumtech/AgentHalo](https://github.com/addsumtech/AgentHalo). Do not merge store sandbox changes back into that repo, and do not link it from the store listing or review notes: it bundles third-party characters.

## Build

```bash
cd agenthalo
npm install
npm run build:mas
```

The signed `.pkg` needs an Apple Distribution certificate, a Mac Installer certificate, and a Mac App Store provisioning profile. Upload with Transporter after App Store Connect has the app record.

Listing copy, review notes and screenshot rules live in `store/CONNECT.md`. The privacy policy and support page are `docs/PRIVACY.md` and `docs/SUPPORT.md`; both must be reachable at a public URL before submission.
