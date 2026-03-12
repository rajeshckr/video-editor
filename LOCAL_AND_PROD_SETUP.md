# Unified Domain Setup (Local + Production) - Upskill Projects

This runbook documents the current setup for:
- Upskill frontend
- Upskill backend
- Video editor frontend
- Video editor backend

All apps are served under one domain using path-based reverse proxying.

## 1. URL Routing Map

| Public URL | Target Service | Local Target |
|---|---|---|
| `/` | Upskill frontend (Angular) | `http://localhost:4200` |
| `/api/*` | Upskill backend (.NET) | `http://localhost:50944` |
| `/editor/*` | Video editor frontend (Vite/React) | `http://localhost:5173` |
| `/vapi/*` | Video editor backend (Node/Express) | `http://localhost:3001` |
| `/@vite/*`, `/@react-refresh*`, `/src/*`, `/node_modules/*`, `/vite.svg` | Vite dev assets (for `/editor`) | `http://localhost:5173` |

## 2. Local Developer Setup

### 2.1 Hosts entry (Windows)
File: `C:\Windows\System32\drivers\etc\hosts`

Add:
```
127.0.0.1 www.example.com
127.0.0.1 example.com
```

Then run:
```powershell
ipconfig /flushdns
```

### 2.2 Caddy config
File: `Caddyfile.local`

Use path routing to all 4 apps (already configured).
Important points:
- Site address is `http://www.example.com` (HTTP local dev)
- `/editor` redirects to `/editor/`
- Vite root asset paths are proxied (`/@vite/*`, `/src/*`, etc.)

### 2.3 App ports (fixed)
- Upskill frontend: `4200`
- Upskill backend: `50944`
- Video frontend: `5173`
- Video backend: `3001`

### 2.4 Frontend host-header settings
- Angular (`upskillm-frontend/angular.json`):
  - `serve.options.host = 0.0.0.0`
  - `serve.options.port = 4200`
  - `serve.options.allowedHosts` includes `www.example.com`, `example.com`, `localhost`
- Vite (`video-editor/frontend/vite.config.ts`):
  - `server.allowedHosts` includes `www.example.com`, `example.com`, `localhost`

### 2.5 Video editor API base
File: `video-editor/frontend/.env`

```
VITE_API_BASE_URL=/vapi
```

## 3. Video Backend CORS

File: `video-editor/backend/.env`

`FRONTEND_URL` is now comma-separated and used as the full CORS allow list.

Example local value:
```
FRONTEND_URL=http://localhost:5173,http://localhost:4200,http://127.0.0.1:5173,http://127.0.0.1:4200,http://www.example.com,http://example.com
```

Notes:
- No separate `CORS_ALLOWED_ORIGINS` is used anymore.
- In code, allowed origins are parsed from `FRONTEND_URL`.

## 4. Start Order (Local)

1. Start Upskill backend (`50944`)
2. Start Video backend (`3001`)
3. Start Upskill frontend (`4200`)
4. Start Video frontend (`5173`)
5. Start Caddy with `Caddyfile.local`

Use script: `start-local-stack.bat` (writes `Caddyfile.local` and starts all).

## 5. Quick Validation Checklist

Run:
```powershell
Invoke-WebRequest http://www.example.com -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://www.example.com/editor/ -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://www.example.com/@vite/client -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://www.example.com/vapi/api/health -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest http://www.example.com/api/swagger -UseBasicParsing | Select-Object StatusCode
```

Expected:
- Root and editor return `200`
- Vite client endpoint returns `200`
- Video backend health returns `200`
- Upskill swagger endpoint returns `200`

## 6. Production Setup

Use the same URL shape in production:
- `https://your-domain.com/` -> Upskill frontend
- `https://your-domain.com/api/*` -> Upskill backend
- `https://your-domain.com/editor/*` -> Video frontend
- `https://your-domain.com/vapi/*` -> Video backend

### 6.1 Reverse proxy
Any ingress/reverse proxy (Caddy, Nginx, App Gateway, etc.) is fine.
Keep the same path routing behavior as local.

### 6.2 CORS for video backend
Set `FRONTEND_URL` to production origins (comma-separated), for example:
```
FRONTEND_URL=https://your-domain.com,https://www.your-domain.com
```

### 6.3 Secret/config management
Do not keep credentials in committed config files.
Use environment variables or secret manager for:
- DB connection strings
- API keys
- JWT secrets
- SMTP credentials

### 6.4 Upskill backend DB note
Upskill backend uses:
- `ConnectionStrings:master` for master DB
- tenant DB connection resolved dynamically per host from tenant metadata

## 7. Common Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `Invalid Host Header` on `www.example.com` | Dev server host check | Add domain to Angular/Vite `allowedHosts` |
| `403 Blocked request. This host is not allowed` on `/editor` | Vite host allow list missing domain | Update `vite.config.ts` `server.allowedHosts` |
| `502` from Caddy for `/editor` | Upstream not reachable (IPv4/IPv6 mismatch or process down) | Use `localhost` upstreams and confirm app is listening |
| CORS error from `/vapi` | Video backend origin not in `FRONTEND_URL` | Add origin(s) to `FRONTEND_URL` and restart backend |
| `/api/tenant/info` returns 500/404 | Tenant host not mapped in master tenant data or old backend process | Ensure tenant host mapping exists and restart Upskill backend |

## 8. Current Known Config Mismatch to Review

In `upskillm-frontend/src/app/environment.ts`, `videoEditorApiBaseUrl` currently points to `/video-editor-api/api`.
If you want all traffic to go through Caddy `/vapi`, change it to:
```
/vapi/api
```
(or add a `/video-editor-api/*` route in Caddy).
