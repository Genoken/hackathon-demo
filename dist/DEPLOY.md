# BandarOS demo — deploying to a VPS

Self-contained. **Node 24+ and nothing else**: no pnpm, no `npm install`, no
`node_modules`, no repo, no database, no API keys. Copy the folder and run it.

## What it is

Three public origins on one host:

| port | what | equivalent in development |
|------|------|---------------------------|
| 8080 | the landing page — **this is the submission URL** | — |
| 8081 | Command Centre (desktop) | `pnpm dev:mock` :5173 |
| 8082 | Field App (mobile) | `pnpm dev:mock` :5174 |

Behind them, on loopback only as far as visitors are concerned: a GraphQL BFF
(:4000) and a fixture server (:4010) that replays recorded engine responses.
There is no engine and no Postgres on the box.

The landing page's two links are written per request from the `Host` header, so
the same folder works on an IP, a domain, or localhost with no rebuild.
`x-forwarded-proto` / `x-forwarded-host` are honoured behind a reverse proxy.

## Install

```bash
sudo useradd -r -m -d /opt/bandaros-demo demo      # or use an existing user
sudo rsync -a dist/ /opt/bandaros-demo/            # copy the artifact
sudo chown -R demo:demo /opt/bandaros-demo
sudo -u demo /opt/bandaros-demo/start.sh           # check it comes up, ctrl-c
sudo cp /opt/bandaros-demo/bandaros-demo.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now bandaros-demo
```

## Firewall — do this, it matters

Open **only** the three public ports. The BFF (4000) and the fixture server
(4010) listen on all interfaces, and the fixture server carries test levers
(`?_fixture=`, `/__mock/…`) that must not be reachable from outside.

```bash
sudo ufw allow 8080,8081,8082/tcp
sudo ufw deny 4000/tcp && sudo ufw deny 4010/tcp
sudo ufw enable
```

## HTTPS (optional but better for a judge)

Put Caddy in front and point the three names at the three ports:

```
demo.example.com        { reverse_proxy 127.0.0.1:8080 }
portal.demo.example.com { reverse_proxy 127.0.0.1:8081 }
field.demo.example.com  { reverse_proxy 127.0.0.1:8082 }
```

Then tell the landing page the public names, since they are no longer
host-plus-port:

```
Environment=PORTAL_URL=https://portal.demo.example.com/
Environment=FIELD_URL=https://field.demo.example.com/
```

(Add those to the `[Service]` block and `systemctl restart bandaros-demo`.)

## Ports

Every port is overridable: `LANDING_PORT`, `PORTAL_PORT`, `FIELD_PORT`,
`MOCK_PORT`, `BFF_PORT`, and `BIND_HOST` (default `0.0.0.0`).

## Signing in

Any of the seeded accounts, password `demo`:
`aishah@` (triage desk) · `siti@` (roads) · `faizal@` / `rizal@` (field crews),
all `@mbpp.demo`.

## What this demo is honest about

- It is a **guided walkthrough, not a sandbox**. Screens the recording drive
  reached answer perfectly; anything off that path answers
  `501 MOCK_FIXTURE_MISSING` rather than inventing data.
- The fixture server does not check passwords, and signs in any address it has
  a recording for. This matches the development stack exactly.
- The recorded morning is dated **20 Aug 2026**. Relative times and SLA badges
  are computed against today, so the further from that date it runs, the more
  the queue reads as overdue.

## Logs

`/opt/bandaros-demo/logs/{mock,bff,serve}.log`, or `journalctl -u bandaros-demo -f`.
