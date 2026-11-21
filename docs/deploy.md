# Deploying Pluxum

Pluxum ships as two images on GitHub Container Registry, run together with PostgreSQL and Valkey from one
compose file:

| Image                           | Role                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| `ghcr.io/itzdrli/pluxum-server` | Pluxel host with every forum plugin, bundled into one standalone program  |
| `ghcr.io/itzdrli/pluxum-web`    | Forum frontend (React Router SSR); forwards `/api/forum/**` to the server |

You need a Linux machine with Docker Compose and a domain. People sign up with email and password
out of the box; an OpenID Connect provider (Zitadel, Keycloak, Authentik, Auth0, …) is optional.

## 1. Configure

```sh
mkdir pluxum && cd pluxum
curl -fsSLO https://raw.githubusercontent.com/itzdrli/Pluxum/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/itzdrli/Pluxum/main/.env.example -o .env
```

Fill in `.env`:

- `PLUXUM_DOMAIN`: the forum's domain. HTTPS is required (sign-in cookies are `Secure`).
- `POSTGRES_PASSWORD`: any long random string (`openssl rand -hex 24`).
- Optional, to also sign in through an identity provider: `FORUM_OIDC_ISSUER`, `FORUM_OIDC_CLIENT_ID`.
  Create an application at your provider with the redirect URI
  `https://<PLUXUM_DOMAIN>/api/forum/auth/callback`. A public (PKCE) client needs nothing else; a
  confidential client's secret is entered in Workbench after the first start (step 3).
  `FORUM_ADMIN_SUBJECTS` lists provider user IDs (the `sub` claim) that become admins when they sign in.
  `FORUM_OIDC_BUTTON_LABEL` sets the provider button's text on the sign-in page (e.g. `Sign in with OIDC`);
  it can also be changed later in Forum Auth's settings.

## 2. Start

With the bundled Caddy obtaining a certificate (ports 80 and 443 free, DNS pointing at this machine):

```sh
docker compose --profile caddy up -d
```

Or behind a reverse proxy you already run: `docker compose up -d`, then proxy `PLUXUM_DOMAIN` to
`127.0.0.1:3000` (`PLUXUM_HTTP_BIND` / `PLUXUM_HTTP_PORT` change that; for a proxy in another container set
`PLUXUM_HTTP_BIND=0.0.0.0` or attach `web` to its network). Pass the original `Host` and use HTTPS to the
browser.

The first start creates the database schema; `docker compose logs -f server` shows progress.

## 3. Workbench (admin)

Workbench manages plugins, their settings and secrets (OIDC client secret, SMTP password, S3 credentials).
It listens only on the server's loopback (`127.0.0.1:8080`) and lets in whoever reaches that port, so open it
through an SSH tunnel:

```sh
ssh -L 8080:127.0.0.1:8080 you@server
# then browse http://localhost:8080/__pluxel/workbench
```

Keep the local side of the tunnel at `localhost:8080`, or change `PLUXUM_ADMIN_PORT` on both sides: Workbench
only accepts the origin `http://localhost:<PLUXUM_ADMIN_PORT>`. Never publish this port publicly.

Things to set there after the first start:

- **Become admin**: sign up on the forum, then tick 管理员 next to your account in **论坛管理 › 用户**.
- **Brand**: **论坛管理 › 品牌** takes your logo, site icon and link preview image; the site name,
  tagline and default theme are in **Forum Core**'s settings, the footer in **Forum Footer**'s.
- **Forum Accounts**: open or close sign-ups. Without mail, its **账号** page makes one-time password
  reset links for you to hand out.
- **Forum Auth**: the client secret if your OIDC client is confidential, then _check the login service_.
- **Forum Mail**: SMTP server and password, to send reply and mention notifications and let people
  reset their own passwords.
- **Forum Storage**: attachments are stored in the server volume by default; switch to an S3-compatible
  bucket here if you prefer.

## Data and backups

| Volume          | Contents                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| `postgres-data` | Forum data                                                                  |
| `server-data`   | Host state and saved settings, encrypted Vault (secrets), local attachments |
| `valkey-data`   | Sign-in sessions (losing it only signs everyone out)                        |

Back up `postgres-data` (`docker compose exec postgres pg_dump -U pluxum pluxum > pluxum.sql`) and
`server-data` together: Vault keys live in `server-data`, and without them saved secrets cannot be read.

## Upgrade

```sh
docker compose pull && docker compose up -d
```

Pin a release with `PLUXUM_VERSION` in `.env` instead of `latest` to upgrade deliberately.

## Building the images yourself

```sh
docker build --target server -t ghcr.io/itzdrli/pluxum-server:local .
docker build --target web -t ghcr.io/itzdrli/pluxum-web:local .
```

Then set `PLUXUM_VERSION=local`. The build checks out Pluxel at the commit pinned in the `Dockerfile`
(`PLUXEL_REF`) because the framework is not published to npm yet.
