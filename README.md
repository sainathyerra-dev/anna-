# Anna — your brother, running on your own machine

This is the standalone version of Anna: a small server holds your Anthropic API key safely,
and a webpage (that looks and works exactly like the Claude artifact version) talks to that server.

## 1. One-time setup

**Requirements:** [Node.js](https://nodejs.org) version 18 or newer installed on your computer.
Check with:
```
node -v
```

**Steps:**

1. Unzip / open this folder in a terminal.
2. Install dependencies:
   ```
   npm install
   ```
3. Get your Anthropic API key from https://console.anthropic.com/settings/keys
4. Copy `.env.example` to a new file named `.env`, and paste your key in:
   ```
   cp .env.example .env
   ```
   Then open `.env` and replace `sk-ant-your-key-here` with your real key.

## 2. Run it

```
npm start
```

You'll see:
```
🟢 Anna is running — open http://localhost:3000 in your browser
```

Open that link in Chrome (or any browser). Anna will load, remember your chats and daily
ledger taps in a local file (`data/db.json`), and everything works exactly like before —
just running on your own machine now, with your own API key.

Leave the terminal window open while you use it. Closing the terminal stops the server.

## 3. Your data

Chat history and your daily check-in ledger are stored in `data/db.json` in this folder —
plain text, on your machine, nowhere else. Delete that file any time to start fresh, or use
the "clear conversation history" link in the app.

## 4. Billing note

Each message you send calls the Anthropic API using your key, billed to your Anthropic
account (pay-as-you-go, roughly a few cents per exchange with Claude Sonnet — check current
pricing at https://www.anthropic.com/pricing). This is separate from any Claude.ai subscription.

## 5. Hosting it online later (so it works from your phone too)

When you're ready to access Anna from anywhere, not just your laptop:

1. Push this folder to a GitHub repo (leave `.env` out — there's a `.gitignore` for that).
2. Create a free account on [Render](https://render.com) or [Railway](https://railway.app).
3. Create a new "Web Service" pointing at your repo.
4. Set the start command to `npm start`.
5. Add an environment variable `ANTHROPIC_API_KEY` with your real key in the host's dashboard
   (never commit it to GitHub).
6. Deploy — you'll get a public URL you can open from your phone or any browser.

The code doesn't need to change for this step; it already reads the port and key from
environment variables, which is exactly how these hosts expect it.
