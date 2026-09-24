# AgentHalo (Mac App Store)

This tree is the **store-only** build. It is not the GitHub / `npx agenthalo` full app.

- Bundle id: `com.addsum.agenthalo`
- Sandbox: users must pick each tool’s config folder before hooks are written
- Built-in characters: 17 original companions plus Jobs, Munger, and Sun Wukong. No living-person likenesses.
- License: AGPL-3.0-only

The unrestricted desktop build stays in [addsumtech/AgentHalo](https://github.com/addsumtech/AgentHalo). Do not merge store sandbox changes back into that repo.

## Build

```bash
cd agenthalo
npm install
npm run build:mas
```

The signed `.pkg` needs an Apple Distribution certificate, a Mac Installer certificate, and a Mac App Store provisioning profile. Upload with Transporter after App Store Connect has the app record.

Listing copy and review notes live in `store/CONNECT.md`.
