# Anna — your personal AI companion

Anna is a private, single-user AI conversation app with daily habit tracking. This version fixes overlapping requests, silent save failures, reset races, local dates, invalid data, mobile controls, and unprotected hosted API access.

## Run on your Windows computer

Install a supported Node.js LTS release, version 22 or newer. Open this folder in PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env` locally and enter your Anthropic API key. Then run `npm start` and open http://localhost:3000. Keep the terminal running. No real AI replies are possible without an API key and API billing. Local mode binds to 127.0.0.1, so it is accessible only on this computer.

## Existing free Render service

Use your existing GitHub repository and Render service; no paid upgrade is needed for device storage.

1. Set Render build command to `npm ci` and start command to `npm start`.
2. Set `NODE_ENV=production` and `STORAGE_MODE=browser`.
3. Set `APP_PASSWORD` to your own strong password, at least 16 characters. Enter it directly in Render, never in the repository or a chat.
4. Set `ANTHROPIC_API_KEY` directly in Render. It must be a real key, not an environment name. Do not publish it.
5. Use `/health` for Render's health check.
6. Upload the corrected source files to the existing repository, preserving the `public/` and `test/` directories. Exclude `.env`, `node_modules/`, and `data/`. Deploy the corrected commit.
7. Visit your HTTPS Render URL and sign in with your Anna password.

Free services can sleep, so the first page load after inactivity may take time. Device history survives server restarts, but there is no automatic sync between your laptop and phone.

## Data and backups

- In `STORAGE_MODE=browser`, conversations and habits are saved in this browser's local storage. Clearing site data, using private browsing, changing origin/domain, or losing your device can remove them. The password protects the hosted API, but local browser data is not encrypted and can be accessed by someone with access to your browser profile. Signing out hides the app but does not delete device history.
- Use **Export backup** regularly. **Restore backup** replaces the current device's conversation and habit ledger from a valid JSON backup. Export first if you want to preserve the current data. Exported backups contain plaintext conversations.
- In `STORAGE_MODE=file`, data lives in `data/db.json` or `DATA_DIR/db.json`. Saves are atomic with one previous-version `.bak` file. Corrupt data stops startup instead of silently erasing history.
- For hosted file storage, attach a persistent disk and set `DATA_DIR` to its mounted directory. This requires a paid Render service. Never use temporary hosting storage for durable chat history.
- The most recent conversation context is sent to Anthropic for each reply; it is not limited to your device. Very long conversations keep the full saved transcript, but Anna sees only a bounded recent portion, and the UI tells you when context is shortened. There is no permanent AI memory or automatic summary in this version.
- Clearing a conversation preserves habits. Failed requests appear as errors, not fake assistant messages. Retry sends the existing unanswered message rather than duplicating it.

## Phone app experience

The app includes a web manifest, icons, and service worker for a home-screen app experience. On compatible Android browsers use Install app / Add to Home Screen; on iPhone use the browser's Add to Home Screen action. Exact controls depend on browser. A network connection is still required; chat and API responses are not cached offline. Phone keyboard behavior still requires testing on your physical device.

## Tests and limits

Run `npm test`. The tests use mocked provider replies; they never spend API credit. They cover authentication, cross-site write rejection, malformed state, revision conflicts, atomic file saving, disk failures, device storage, duplicate sends, failed startup, API errors, local dates, long streaks, and bounded history.

This is a personal app, not a multi-user messenger. Rate limits are deliberately shared by this single-user server. Sessions last seven days; changing APP_PASSWORD invalidates prior sessions. Use a fresh private password if you need to revoke all sessions. Provider usage is billed separately from hosting and consumer AI subscriptions.

Hosting documentation: https://render.com/docs/free and https://render.com/docs/web-services
