# Logbook

Organize work across organizations, projects, and notes — with rich-text notes, long-form Story docs, Todos, Reminders, Ideas, and full-text search, all in one self-hosted app.

## Features

- **Notes** — Quick, Descriptive, and Sketch (freehand drawing) note types, with labels, tags, pinning, and Markdown rendering (tables, code blocks with syntax highlighting, Mermaid diagrams).
- **Story** — long-form documentation pages per project, with a sticky write/preview editor, table of contents, and deep-linkable pages.
- **Todos, Reminders, Ideas** — per-project task tracking, timed reminders (with an iCal feed), and a lightweight idea backlog that can be promoted to todos.
- **Search** (⌘K) — tabbed search across Story, Notes, Todos, and Reminders.
- **Rich editing toolbar** — Markdown formatting, inline drawings, handwritten-style text, and voice typing (Web Speech API — needs a secure context: HTTPS or `localhost`).
- **AI features** (optional, configured in-app under Settings) — Ollama or OpenAI-backed summaries, grammar checking, and Q&A over your notes.
- **Calendar feed** — subscribe to todos/reminders from any calendar app via iCal.
- **File attachments** — via any S3-compatible store (MinIO, AWS S3, etc.), optional.
- **Import/export** — portable JSON/ZIP export and import between Logbook instances.

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or newer
- [PostgreSQL](https://www.postgresql.org/) 13+ (the only required datastore)
- Optional: [Redis](https://redis.io/) (read caching — the app works fine without it, just uncached), an S3-compatible store like [MinIO](https://min.io/) (file attachments), [Docker](https://www.docker.com/) (containerized run/deploy)

**Windows**: everything below works either natively or under [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) (`wsl --install`, then follow the Linux-style steps inside your WSL shell — this is the path of least friction, since Postgres/Redis/nginx all have first-class Linux packaging). Native-Windows steps are called out separately where they differ.

## Quick start (local, no Docker)

### macOS / Linux

```bash
npm install

# Postgres must be running and reachable (see Environment variables below
# for how to point at a non-default host/db/credentials)
createdb logbook   # only needed once, if the database doesn't exist yet

npm run dev         # nodemon, restarts on file changes
# or
npm start           # plain node server.js
```

### Windows (native, PowerShell)

```powershell
npm install

# Install PostgreSQL from https://www.postgresql.org/download/windows/
# (or: winget install PostgreSQL.PostgreSQL), then create the database —
# the installer adds `createdb` to PATH, or use pgAdmin's GUI instead:
createdb logbook

npm run dev
# or
npm start
```

The app creates its own tables on first boot (`database/db.js` runs schema DDL/migrations automatically — no separate migration step needed) and listens on `http://localhost:3000` by default (set `PORT` to change it — the Docker image below uses `3737`).

## Environment variables

None of these are required to have a value set — every one has a working local-dev default. Set them via a shell export, a process manager, or `docker-compose.yml`'s `environment:` block. (Note: `server.js` does **not** load `.env` automatically — `.env` in this repo is only read by `scripts/build-push-deploy.sh`.)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port the app listens on (the Docker image sets this to `3737`) |
| `BASE_PATH` | *(empty)* | Mount the app under a sub-path, e.g. `/logbook`, behind a reverse proxy |
| `PG_HOST` | `localhost` | Postgres host |
| `PG_PORT` | `5432` | Postgres port |
| `PG_DB` | `logbook` | Postgres database name |
| `PG_USER` | `postgres` | Postgres user |
| `PG_PASSWORD` | `postgres` | Postgres password |
| `REDIS_HOST` | `127.0.0.1` | Redis host — cache is skipped transparently if Redis is unreachable |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | *(none)* | Redis password, if required |
| `REDIS_DB` | `0` | Redis logical DB index |
| `MINIO_ENDPOINT` | *(unset — uploads disabled)* | S3-compatible endpoint, e.g. `http://localhost:9000` |
| `MINIO_ACCESS_KEY` | `minioadmin` | S3 access key |
| `MINIO_SECRET_KEY` | `minioadmin` | S3 secret key |
| `MINIO_BUCKET` | `logbook` | S3 bucket name |
| `MINIO_PUBLIC_URL` | same as `MINIO_ENDPOINT` | Public URL prefix for serving uploaded files |
| `TODOIST_API_TOKEN` | *(unset — sync disabled)* | Enables two-way Todo ↔ Todoist task sync |
| `TODOIST_PROJECT_ID` | *(unset)* | Todoist project to sync into |

Storage (MinIO/S3) can also be configured live from **Settings → File Storage** in the app, without restarting — the env vars above are just the startup defaults. AI providers (Ollama/OpenAI) are configured the same way, under **Settings → AI Integration**, and aren't env vars at all.

## Optional: Redis caching

If Redis isn't reachable, the app logs one warning and runs uncached — no functionality is lost, requests just hit Postgres directly. To enable caching locally:

```bash
# macOS
brew install redis
brew services start redis
```

```bash
# Linux / WSL2
sudo apt install redis-server   # or your distro's equivalent
sudo service redis-server start
```

**Windows (native)**: Redis Inc. no longer ships official Windows builds. Easiest options, in order of least friction: run it under WSL2 (above), run the official `redis` Docker image (`docker run -d -p 6379:6379 redis`), or install [Memurai](https://www.memurai.com/) (a Redis-protocol-compatible native Windows service). Any of the three work — the app only needs something answering the Redis protocol on `REDIS_HOST:REDIS_PORT`.

Cached endpoints use short TTLs (15–60s) and are proactively invalidated on writes, so data is never stale by more than a few seconds even without a mutation touching that exact cache key.

## Running with Docker

```bash
docker compose up --build
# or: ./start.sh
```

`docker-compose.yml` runs the full stack in containers: the app, **Redis** (cache), **MinIO** (file storage), and **nginx** (reverse proxy / TLS termination for `https://logbook.local` — see below). The one exception is **Postgres**, which stays on the **host** machine and is reached via `host.docker.internal` (see the `environment:` block in `docker-compose.yml`) — so Postgres should be running locally, not inside the compose stack.

- Redis and MinIO are only reachable from other containers on the compose network (`redis`, `minio` hostnames) — MinIO's ports are also published to the host (`9000` API, `9001` console) for admin access at `http://localhost:9001`.
- MinIO's data directory is a bind mount controlled by `MINIO_DATA_DIR` in `.env` (defaults to `./data/minio`) — point it at an existing MinIO data directory to reuse its buckets/files instead of starting empty.
- The app itself is still reachable directly on `http://localhost:3737`, bypassing nginx, if you don't need HTTPS.

On Windows, install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (using the WSL2 backend, which is the default) and run the same `docker compose up --build` command — or `.\start.ps1` — from PowerShell or your WSL2 shell. `host.docker.internal` resolves correctly under Docker Desktop on Windows too, with no extra configuration.

### Build / push / deploy script

```bash
bash scripts/build-push-deploy.sh 2>&1 | tail -40
```

Reads config from `.env` (`IMAGE_NAME`, `IMAGE_TAG`, `PUSH_IMAGE`, `DEPLOY_AFTER_BUILD`, `PUSH_LATEST`), builds the Docker image via `docker compose build app`, and optionally pushes/deploys it. `IMAGE_NAME` must start with `local-` as a safety check.

## Optional: trusted HTTPS for local development (`https://logbook.local`)

Some browser features — notably voice typing (Web Speech API) and microphone access — only work on a secure origin (`https://` or `http://localhost`). The `nginx` service in `docker-compose.yml` handles this automatically: it terminates TLS for `logbook.local` and reverse-proxies to the `app` container, redirecting plain HTTP to HTTPS. You only need to provision the hostname and certificate once.

### HTTPS on macOS / Linux

1. Map the hostname to your machine in `/etc/hosts`: `127.0.0.1 logbook.local`
2. Install [mkcert](https://github.com/FiloSottile/mkcert) and trust its local CA once: `brew install mkcert nss && mkcert -install`
3. Generate a certificate straight into the path nginx mounts:

   ```bash
   cd nginx/certs
   mkcert -cert-file logbook.local.pem -key-file logbook.local-key.pem logbook.local
   ```

   (`nginx/certs/` is gitignored — the cert/key are machine-local, not committed.)
4. `docker compose up --build` (or restart the `nginx` service if the stack is already running) and browse to `https://logbook.local`.

If you'd rather run a **host-installed** reverse proxy instead of the dockerized one (e.g. to front several unrelated apps), point it at the app's port (`3737`) with the same generated `.pem`/`-key.pem` files and redirect port 80 → 443 — the `nginx.conf` in this repo is a working example to copy from.

### HTTPS on Windows

1. Map the hostname in `C:\Windows\System32\drivers\etc\hosts` (edit with an elevated/Administrator Notepad): `127.0.0.1 logbook.local`
2. Install mkcert — via [Chocolatey](https://chocolatey.org/) (`choco install mkcert`) or [Scoop](https://scoop.sh/) (`scoop install mkcert`) — then trust its local CA once: `mkcert -install`
3. Generate a certificate: `mkcert logbook.local`
4. Reverse proxy: [Caddy](https://caddyserver.com/) is the least-friction option on Windows (single binary, no separate service wrapper needed) — point it at the app with a `Caddyfile`:

   ```caddyfile
   logbook.local {
       tls logbook.local.pem logbook.local-key.pem
       reverse_proxy 127.0.0.1:3737
   }
   ```

   then run `caddy run`. Alternatively, use the official [nginx for Windows](https://nginx.org/en/docs/windows.html) build with the same `ssl_certificate`/`ssl_certificate_key` config as the macOS/Linux steps above.
5. Browse to `https://logbook.local`.

## Project structure

```text
server.js           Express app bootstrap, route mounting, static file serving
routes/              One file per API resource (organizations, projects, notes, todos, ...)
lib/                 Shared server-side helpers (storage, cache, logging, Todoist sync)
database/db.js       Postgres pool + schema/migrations, run automatically on boot
public/              Static frontend — plain HTML/CSS/JS, no build step
scripts/             Deploy tooling
```
