// Server-rendered HTML for the OAuth consent/login step and the connector's
// landing page. Deliberately dependency-free (no template engine, no assets):
// these pages are shown inside an MCP client's popup, must render instantly,
// and must not depend on the SPA build.
import { mcpConfig } from '../config.js'

export interface LoginParams {
  client_id: string
  redirect_uri: string
  state: string
  scope: string
  code_challenge: string
  code_challenge_method: string
  resource: string
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0b0f14; color: #e6edf3; padding: 24px;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .card {
    width: 100%; max-width: 420px; background: #121820; border: 1px solid #1f2933;
    border-radius: 14px; padding: 28px; box-shadow: 0 18px 50px rgba(0,0,0,.45);
  }
  h1 { font-size: 19px; margin: 0 0 6px; letter-spacing: -.01em; }
  p  { margin: 0 0 18px; color: #8b98a5; font-size: 13.5px; }
  label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #8b98a5; margin-bottom: 8px; }
  input[type=password], input[type=text] {
    width: 100%; padding: 11px 13px; border-radius: 9px; border: 1px solid #26313d;
    background: #0b0f14; color: #e6edf3; font-size: 15px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  input:focus { outline: 2px solid #2f81f7; outline-offset: 1px; border-color: transparent; }
  button {
    width: 100%; margin-top: 18px; padding: 11px 14px; border: 0; border-radius: 9px;
    background: #2f81f7; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
  }
  button:hover { background: #4a92f8; }
  .err { background: #2a1418; border: 1px solid #63242c; color: #ff9d9d; padding: 10px 12px; border-radius: 9px; margin-bottom: 16px; font-size: 13.5px; }
  .meta { margin-top: 20px; padding-top: 16px; border-top: 1px solid #1f2933; color: #6e7c8a; font-size: 12px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #9fb3c8; }
  a { color: #6cb0ff; }
`

/** The single-secret login step of the authorization-code flow. */
export function loginPage(
  params: LoginParams,
  opts: { clientName?: string; error?: string } = {},
): string {
  const hidden = (Object.keys(params) as (keyof LoginParams)[])
    .map((k) => `<input type="hidden" name="${k}" value="${esc(params[k])}">`)
    .join('\n      ')
  const who = opts.clientName ? esc(opts.clientName) : 'An MCP client'
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to ${esc(mcpConfig.resourceName)}</title>
<style>${STYLE}</style>
</head><body>
  <form class="card" method="post" action="/mcp-oauth/authorize">
    <h1>Connect to ${esc(mcpConfig.resourceName)}</h1>
    <p>${who} wants to read and update your business dashboard. Paste the connector access key to approve.</p>
    ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ''}
    ${hidden}
    <label for="key">Access key</label>
    <input id="key" name="secret" type="password" autocomplete="current-password" autofocus
           spellcheck="false" placeholder="••••••••••••••••••••">
    <button type="submit">Approve access</button>
    <div class="meta">
      Workspace <code>${esc(mcpConfig.workspaceKey)}</code> · ${
        mcpConfig.allowWrites ? 'read + write' : 'read-only'
      }<br>
      The key is the <code>MCP_SECRET_KEY</code> from the server's <code>.env</code>.
    </div>
  </form>
</body></html>`
}

export function errorPage(title: string, detail: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style>
</head><body>
  <div class="card">
    <h1>${esc(title)}</h1>
    <p>${esc(detail)}</p>
    <div class="meta">Close this window and start the connection again from your MCP client.</div>
  </div>
</body></html>`
}

export function successPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connected</title><style>${STYLE}</style>
</head><body>
  <div class="card">
    <h1>Connected</h1>
    <p>You can close this window and return to your MCP client.</p>
  </div>
</body></html>`
}

/** Human landing page at <publicUrl>/mcp-info — what to paste where. */
export function landingPage(): string {
  const url = mcpConfig.resourceUrl
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(mcpConfig.resourceName)} — MCP connector</title><style>${STYLE}
  .card { max-width: 560px; }
  ol { margin: 0 0 4px; padding-left: 20px; color: #8b98a5; font-size: 13.5px; }
  li { margin-bottom: 8px; }
  .url { display:block; margin: 14px 0 20px; padding: 11px 13px; border-radius: 9px; background:#0b0f14; border:1px solid #26313d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color:#9fb3c8; word-break: break-all; }
</style></head><body>
  <div class="card">
    <h1>${esc(mcpConfig.resourceName)} — MCP connector</h1>
    <p>Remote MCP server (Streamable HTTP + OAuth 2.1). Add this URL as a custom connector:</p>
    <span class="url">${esc(url)}</span>
    <ol>
      <li><strong>Claude</strong> — Settings → Connectors → Add custom connector → paste the URL → approve with the access key.</li>
      <li><strong>ChatGPT</strong> — Settings → Connectors (or a Deep Research / Developer-mode custom connector) → paste the URL → approve with the same key.</li>
      <li><strong>Claude Code</strong> — <code>claude mcp add --transport http business-dashboard ${esc(url)}</code></li>
    </ol>
    <div class="meta">
      Workspace <code>${esc(mcpConfig.workspaceKey)}</code> · ${
        mcpConfig.allowWrites ? 'read + write' : 'read-only'
      } · discovery at <code>/.well-known/oauth-protected-resource/mcp</code>
    </div>
  </div>
</body></html>`
}
