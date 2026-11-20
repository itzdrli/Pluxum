<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup-on-dark.svg">
    <img src="docs/brand/lockup-on-light.svg" alt="Pluxum" height="64">
  </picture>
</h1>

A plugin-first forum on [Pluxel](https://github.com/PluxelJS/pluxel). The host stays small; each feature is a plugin that can be started, stopped and configured from Workbench.

- **Threads and notes**: categories with topic threads, a short-note stream, replies inside a floor, pinning, locking and moving.
- **Reading**: Markdown or a rich-text editor, full-text search (Chinese word segmentation), a command palette, themes, and a layout that works on phones.
- **Accounts**: sign-in through any OpenID Connect provider, roles (member, moderator, admin), avatars and attachments.
- **Community**: reactions, follows, mentions, accepted answers, in-app and email notifications, reports and bans.
- **Two languages**: Chinese and English. Times follow the visitor's own time zone.

## Layout

| Path                         | Role                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `apps/web/`                  | Forum frontend: React Router SSR and HeroUI. Proxies `/api/forum/**` to the host.  |
| `host/`                      | Pluxel application: plugin catalog, database, Workbench, Vault and runtime policy. |
| `host/web/`                  | Placeholder on the host origin. `host/web/dev/` holds dev-console scripts.         |
| `plugins/`                   | One package per feature, listed below.                                             |
| `packages/domain/`           | Shared forum types, rules and error keys, with no Pluxel dependency.               |
| `compose.dev.yaml`           | Local Valkey (`pluxum-valkey` on `127.0.0.1:6380`).                                |
| `compose.yaml`, `Dockerfile` | Production images and the one-file stack. See [docs/deploy.md](docs/deploy.md).    |

### Plugins

| Plugin          | What it does                                                                      |
| --------------- | --------------------------------------------------------------------------------- |
| `core`          | Categories, threads, posts, users and permissions; the other plugins hang off it. |
| `api`           | The `/api/forum` HTTP ingress.                                                    |
| `auth`          | OpenID Connect sign-in and sessions.                                              |
| `markdown`      | Renders and sanitises post bodies.                                                |
| `search`        | Full-text search over threads and replies.                                        |
| `notifications` | The in-app inbox.                                                                 |
| `mail`          | Email notices.                                                                    |
| `mentions`      | `@name` mentions.                                                                 |
| `reactions`     | Likes and 「有用」.                                                               |
| `follows`       | Following people and categories, and the 「关注」 feed.                           |
| `solved`        | Accepted answers.                                                                 |
| `reads`         | Unread markers.                                                                   |
| `moderation`    | Reports, bans, blocked words and the audit log.                                   |
| `rates`         | Rate limits on posting and editing.                                               |
| `attachments`   | File and avatar uploads (local disk or S3-compatible storage).                    |
| `outline`       | The floor timeline beside a thread.                                               |
| `footer`        | The footer's links and notes.                                                     |
| `cache`         | Caches list and render results.                                                   |
| `redis`         | The Redis connection catalog.                                                     |

## Develop

```sh
mise trust && mise install
docker compose -f compose.dev.yaml up -d
vp install
vp run setup          # workspace links for the Pluxel CLI
vp run hooks:install  # Git hooks: format and lint on commit
vp run dev            # host (`app`, :5173) and frontend (`web`, :3000)
vp run verify         # governance, lint, types, tests, production builds
```

`vp run dev` prints the application and Workbench URLs, and reuses a Pitchfork service that is already running.

With a local Pluxel checkout, run that checkout's `pluxel source install --root <this repo>` so `@pluxel/*` resolves to the checkout.

`REDIS_CONNECTIONS` in `mise.toml` seeds the Redis catalog. `FORUM_TEST_REDIS_URL` enables the live Redis test. Machine-local public origins go in the ignored `mise.local.toml`: `PLUXEL_PUBLIC_ORIGIN` for the host and Workbench, `FORUM_WEB_PUBLIC_ORIGIN` for the frontend.

Plugin config declared in `host/src/runtime-state.ts` applies until Workbench saves the same field. Delete the saved value to return to the declaration.

### Tests

Run a package's tests from its own folder with `npx vitest run` (`apps/web`, `packages/domain` and each plugin have their own). `vp run verify` runs everything, but it rebuilds `packages/domain/dist`, and that build can fail; if `dist` ends up empty, `vp pack --no-dts` in `packages/domain` restores it.

### Languages

The frontend is translated with Lingui: Chinese is the source, English the translation. API errors and notification titles are sent as keys and worded by the frontend. Adding a string, a language or an error key: [docs/i18n.md](docs/i18n.md).

## Deploy

Prebuilt images and one compose file (PostgreSQL, Valkey, server, web, optional Caddy): [docs/deploy.md](docs/deploy.md).

## Further reading

- Frontend strings, errors and languages: [docs/i18n.md](docs/i18n.md)
- Coding agents: [AGENTS.md](./AGENTS.md)
- Pluxel: [upstream docs](https://github.com/PluxelJS/pluxel/blob/main/docs/index.md), or `vp exec pluxel docs` after setup
