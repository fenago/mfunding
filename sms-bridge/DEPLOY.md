# SMS Bridge — Deploy Runbook

Relays SMS between the JMP number **+1 (786) 504-1159** and the Supabase table
`public.sms_messages`. Runs as a systemd service on a $6/mo DigitalOcean droplet.

```
phone user <--SMS--> JMP number <--XMPP--> bridge (this droplet) <--> Supabase sms_messages
```

The bridge **opens no public port**. Nothing calls it. It polls Supabase for outbound
work and pushes inbound texts in. Firewall is SSH-only.

- **Outbound:** the app inserts `sms_messages` with `status='queued'` → bridge claims it
  (`sending`) → sends over XMPP → marks `sent` (or `failed` + `error`).
- **Inbound:** bridge inserts `{direction:'inbound', phone, body, media_url, status:'received'}`.
  Customer linking and STOP/opt-out are handled by **DB triggers** — the bridge does not.

---

## Before you start

| You need | Where it comes from |
|---|---|
| `XMPP_PASSWORD` for `mfunding@xmpp.chat` | the password set when the Jabber ID was registered on xmpp.chat |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → project **MFunding** → Project Settings → API → `service_role` secret |
| An SSH key on your Mac | `ls ~/.ssh/id_ed25519.pub` — create with `ssh-keygen -t ed25519` if missing |

> **Both of those are secrets you place by hand on the droplet.** They are never
> committed and never appear in any file in this repo. `.env.example` holds
> placeholders only.

> ⚠️ **Quit every other XMPP client first.** xmpp.chat allows **one** session per
> account. If Gajim, Monal, Converse.js or any browser tab is still logged in as
> `mfunding@xmpp.chat`, the bridge will loop with `conflict` errors. Quit the app
> (or Accounts → toggle the account off) before step 7.

---

## 1. Create the droplet

DigitalOcean → **Create → Droplet**

- Image: **Ubuntu 24.04 LTS**
- Plan: Basic → Regular → **$6/mo** (1 GB / 1 vCPU) — more than enough
- Region: **NYC** (or nearest you)
- Authentication: **SSH key** (not password)
- Hostname: `sms-bridge`

Copy the droplet's public IP. Everything below uses `DROPLET_IP` — substitute it.

## 2. SSH in

```bash
ssh root@DROPLET_IP
```

Accept the host fingerprint on first connect.

## 3. Run the droplet setup

From your Mac (a second terminal tab, in the repo root):

```bash
cd /Users/ernestolee/ClaudeProjects/BassReeves
scp sms-bridge/setup-droplet.sh root@DROPLET_IP:/root/
```

Back on the droplet:

```bash
bash /root/setup-droplet.sh
```

Installs Node 22, creates the unprivileged `bridge` user and `/opt/sms-bridge`,
and enables the firewall with **SSH only**. It prints the Node version when done.

## 4. Copy the app files up

From your Mac:

```bash
cd /Users/ernestolee/ClaudeProjects/BassReeves
scp sms-bridge/index.js \
    sms-bridge/package.json \
    sms-bridge/sms-bridge.service \
    sms-bridge/install-service.sh \
    root@DROPLET_IP:/opt/sms-bridge/
```

Note there is **no `.env` in that list** — you create it by hand next.

## 5. Create the real `.env` on the droplet

On the droplet:

```bash
nano /opt/sms-bridge/.env
```

Paste this and replace the two `change-me` values with the real secrets from the
"Before you start" table:

```
XMPP_JID=mfunding@xmpp.chat
XMPP_PASSWORD=change-me
SUPABASE_URL=https://ehibjeonqpqskhcvizow.supabase.co
SUPABASE_SERVICE_ROLE_KEY=change-me
POLL_MS=2000
```

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`.

The service_role key is a full-access key. It stays on this droplet, is chmod 600,
and is only readable by root and the `bridge` user.

## 6. Install and start the service

On the droplet:

```bash
bash /opt/sms-bridge/install-service.sh
```

Installs dependencies as the `bridge` user, installs the systemd unit, enables it
at boot, and starts it.

## 7. Watch it connect

```bash
journalctl -u sms-bridge -f
```

You are looking for these three lines, in order:

```
... sms_messages reachable
... starting bridge for mfunding@xmpp.chat -> table sms_messages
... xmpp online as mfunding@xmpp.chat/sms-bridge
```

If you see `FATAL: cannot read sms_messages`, the Supabase URL/key is wrong or the
table doesn't exist yet — fix `.env` and `systemctl restart sms-bridge`.

Leave this log tailing for the smoke tests. `Ctrl+C` exits the tail (it does not
stop the service).

## 8. Smoke test — INBOUND

From your cell phone, text **(786) 504-1159**: `bridge test inbound`

Within a couple of seconds the log prints:

```
... inbound +1YOURCELL "bridge test inbound"
```

Confirm in Supabase → Table Editor → `sms_messages`: a new row with
`direction='inbound'`, `status='received'`, your phone in `phone`.

## 9. Smoke test — OUTBOUND

Supabase dashboard → SQL Editor (replace with your own cell in E.164):

```sql
insert into public.sms_messages (direction, phone, body, status)
values ('outbound', '+1YOURCELL', 'hello from the bridge', 'queued');
```

Within ~2 s the log prints `sent -> +1YOURCELL "hello from the bridge"`, your phone
buzzes, and the row flips to `status='sent'` with `sent_at` filled in.

> If outbound never sends but inbound works: JMP will not let the number send until
> a real person has texted it first. Step 8 satisfies that — do it before step 9.

**Both tests passing = done.** The service restarts on crash and on droplet reboot.

---

## Day-to-day

| Task | Command (on the droplet) |
|---|---|
| Tail logs | `journalctl -u sms-bridge -f` |
| Last 200 log lines | `journalctl -u sms-bridge -n 200 --no-pager` |
| Status | `systemctl status sms-bridge` |
| Restart | `systemctl restart sms-bridge` |
| Stop / start | `systemctl stop sms-bridge` / `systemctl start sms-bridge` |

**Ship a code change** (from your Mac):

```bash
scp /Users/ernestolee/ClaudeProjects/BassReeves/sms-bridge/index.js root@DROPLET_IP:/opt/sms-bridge/
ssh root@DROPLET_IP "chown bridge:bridge /opt/sms-bridge/index.js && systemctl restart sms-bridge"
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `xmpp error: conflict`, keeps disconnecting | Another client is logged in as `mfunding@xmpp.chat`. Quit Gajim / Monal / any Converse.js tab, then `systemctl restart sms-bridge`. One session per account. |
| `xmpp error: not-authorized` | Wrong `XMPP_JID` or `XMPP_PASSWORD` in `/opt/sms-bridge/.env`. Retype the password (no trailing space), restart. |
| `FATAL: cannot read sms_messages` at boot | Bad `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, or the table doesn't exist. The service intentionally refuses to run half-blind. |
| `POLL FAILED (queue UNREADABLE …)` in the log | Supabase is unreachable or the key was rotated. This is **not** an empty queue — outbound is down until it clears. |
| Online, but inbound rows never appear | The cheogram.com contact request was never accepted. Restart the bridge (it auto-accepts), or accept once in Gajim and then log that client out. |
| Rows stuck at `queued` | The bridge isn't `online` — check `journalctl`. Rows stranded in `sending` are re-queued at startup and after 2 min. |
| Outbound row goes `failed` with `phone is not E.164` | The `phone` column wasn't a valid number. Store E.164 (`+17865041159`). The bridge auto-fixes bare 10-digit and `1`-prefixed US numbers; anything else fails loudly with the reason in the `error` column. |
| `sent` but the text never arrives | Carrier filtering. JMP is a consumer line — keep messages conversational, avoid identical bulk sends and link-heavy bodies. Check the jmp.chat account page for warnings. |
| Inbound MMS has `media_url` null | Cheogram attaches media as an OOB URL; if it's missing, grab the raw stanza from the log. Outbound MMS is not supported by this bridge — text only. |

**Limits worth knowing:** one bridge process per JMP number (a second number means a
second `.env` + unit file). Bridge downtime is safe — xmpp.chat queues inbound
messages until it reconnects, and outbound rows just wait in `queued`.
