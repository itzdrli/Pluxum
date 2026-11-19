<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup-on-dark.svg">
    <img src="docs/brand/lockup-on-light.svg" alt="Pluxum" height="64">
  </picture>
</h1>

A plugin-first forum on [Pluxel](https://github.com/PluxelJS/pluxel). The host stays small; each feature is a plugin that can be started, stopped and configured from Workbench.

## Layout

| Path                         | Role                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/web/`                  | Forum frontend: React Router SSR and HeroUI. Proxies `/api/forum/**` to the host.                    |
| `host/`                      | Pluxel application: plugin catalog, database, Workbench, Vault and runtime policy.                   |
| `host/web/`                  | Placeholder on the host origin. `host/web/dev/` holds dev-console scripts.                           |
| `plugins/`                   | One package per feature. `api` is the `/api/forum` ingress; `redis` is the Redis connection catalog. |
| `packages/domain/`           | Shared forum types and rules, with no Pluxel dependency.                                             |
| `compose.dev.yaml`           | Local Valkey (`pluxum-valkey` on `127.0.0.1:6380`).                                                  |
| `compose.yaml`, `Dockerfile` | Production images and the one-file stack. See [docs/deploy.md](docs/deploy.md).                      |

## Develop

```sh
mise trust && mise install
docker compose -f compose.dev.yaml up -d
vp install
vp run setup          # workspace links for the Pluxel CLI
vp run hooks:install  # once the Git repo exists
vp run dev            # host (`app`, :5173) and frontend (`web`, :3000)
vp run verify         # governance, lint, types, tests, production builds
```

`vp run dev` prints the application and Workbench URLs, and reuses a Pitchfork service that is already running.

With a local Pluxel checkout, run that checkout's `pluxel source install --root <this repo>` so `@pluxel/*` resolves to the checkout.

`REDIS_CONNECTIONS` in `mise.toml` seeds the Redis catalog. `FORUM_TEST_REDIS_URL` enables the live Redis test. Machine-local public origins go in the ignored `mise.local.toml`: `PLUXEL_PUBLIC_ORIGIN` for the host and Workbench, `FORUM_WEB_PUBLIC_ORIGIN` for the frontend.

Plugin config declared in `host/src/runtime-state.ts` applies until Workbench saves the same field. Delete the saved value to return to the declaration.

## Deploy

Prebuilt images and one compose file (PostgreSQL, Valkey, server, web, optional Caddy): [docs/deploy.md](docs/deploy.md).

## Further reading

- Frontend strings: [docs/i18n.md](docs/i18n.md)
- Coding agents: [AGENTS.md](./AGENTS.md)
- Pluxel: [upstream docs](https://github.com/PluxelJS/pluxel/blob/main/docs/index.md), or `vp exec pluxel docs` after setup
