# golive-mcp

[![npm](https://img.shields.io/npm/v/golive-mcp)](https://www.npmjs.com/package/golive-mcp)
[![CI](https://github.com/myanptl/golive-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/myanptl/golive-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

Check a site before you share the link.

You deploy, paste the link into LinkedIn, and get a grey box with no image. Or someone refreshes `/pricing` and gets a Vercel 404. golive catches both before anyone sees them, plus the staging `noindex` you forgot and the Vite logo still sitting in the tab.

It runs as an MCP server, so Claude, Cursor or any MCP client can check a URL after deploying and fix what it finds. It also runs as a plain CLI. No API key, no account.

## What it found on a fresh Vite app

This is a React app straight out of `npm create vite`, built, and served by a host with no SPA fallback. Real output, trimmed:

```
$ npx golive-mcp check http://localhost:4791 /about

Not ready: 2 blocking, 10 to look at, 4 fine.

## Link previews
✗ og:image: No preview image. On LinkedIn, X and iMessage the link becomes a plain grey text card.
  Fix: Add a 1200x630 image: <meta property="og:image" content="https://yoursite.com/og.png">
! og:title: Missing. Platforms fall back to the <title> ("demo"), which is often not what you want shared.
! twitter:card: Missing. X reads your og: tags but only shows a small thumbnail without this.

## How the link will look
LinkedIn: [no image] / demo / localhost:4791
X: small square thumbnail (no twitter:card tag) / demo / localhost:4791
Slack: localhost:4791 / demo / (none) / [no image]

## Routes
✗ link /about: Opening /about directly returns 404. It works when clicked inside the app,
  but breaks on refresh, bookmark or share.
  Fix: Configure the host to serve index.html for unknown paths, so the client router can take over.
```

On Vercel the fix line names the exact `vercel.json` rewrite. On Netlify it names the `_redirects` line.

## Install

**Claude Code**

```bash
claude mcp add golive -- npx -y golive-mcp
```

**Claude Desktop, Cursor, Windsurf** (add to the MCP config file)

```json
{
  "mcpServers": {
    "golive": { "command": "npx", "args": ["-y", "golive-mcp"] }
  }
}
```

**No MCP client**

```bash
npx golive-mcp check yoursite.com
npx golive-mcp check localhost:5173 /about /pricing
```

The CLI exits with code 1 when anything is blocking, so it drops into CI as a pre-launch gate.

Then ask your assistant something like "I just deployed, check https://mysite.com before I post it" and it will run the checks and fix the findings in your code.

## Tools

| Tool | What it checks |
|---|---|
| `golive` | Everything below in one pass, with a verdict |
| `check_link_preview` | og and Twitter card tags, and whether the image loads, is a raster format, is about 1200x630 and is under 5 MB. Shows how the card will look on LinkedIn, X, Slack, iMessage and Discord, and returns the image itself so the model can look at it |
| `check_routes` | Opens internal links directly, the way a refresh or a shared link does. Catches the SPA 404 and soft 404s |
| `check_basics` | Template titles, the Vite favicon, noindex or `Disallow: /` left from staging, viewport, lang, apple-touch-icon, mixed content |
| `check_security_headers` | HTTPS and the http redirect, HSTS, nosniff, clickjacking protection, CSP, Referrer-Policy, X-Powered-By |

Every tool takes a `url`. `golive` and `check_routes` also take `paths`, a list of routes to open directly. Client-rendered apps have no links in their HTML, so pass your real routes to test them.

## Limits

- The platform mockups are text, not screenshots. Titles get cut by pixel width, so the cut-off points are a guide.
- golive reads the HTML your server sends. It does not run JavaScript, which is also what LinkedIn, Slack and the other scrapers do, so a tag that only appears after React renders is a tag they never see.
- It can check `localhost`, which is the point: run it before you deploy. It only speaks http and https, caps every response at 5 MB and times out after 10 seconds.
- Text quoted from the page (titles, header values) is truncated before it reaches the model, which limits how much a hostile page can inject into your assistant's context.

## Development

```bash
npm install
npm test        # 28 tests against local fixture servers
npm run build
node dist/index.js check example.com
```

## License

MIT
