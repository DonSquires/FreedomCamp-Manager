# Self-hosted MTA Fallback on hPanel VPS

This module is a fallback/disaster-recovery option. It is not the primary production
email path for the current build.

Primary production path: managed Hostinger SMTP wired via Supabase Edge Function
secrets and proxy relay.

## When to use this

- Managed SMTP provider outage
- Compliance requirement for self-hosted mail routing
- Controlled failover drills

## What this gives you

- SMTP submission for app mail: port 587 and 465
- Inbound/outbound mail flow for your domain
- DKIM/SPF/DMARC support (configured through DNS)
- Web admin UI at https://mail.fcmanager.co.nz:8443 (or http://server-ip:8080 during bootstrap)

## 1) VPS prerequisites

Run on your hPanel VPS:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin ufw
sudo systemctl enable --now docker
sudo ufw allow 22/tcp
sudo ufw allow 25/tcp
sudo ufw allow 465/tcp
sudo ufw allow 587/tcp
sudo ufw allow 993/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## 2) Deploy MTA

```bash
cd /opt
sudo mkdir -p fcmanager-mta
sudo chown -R $USER:$USER fcmanager-mta
cd fcmanager-mta

# copy files from repo ops/mta/ into this folder
cp .env.example .env
# edit .env: set POSTE_ADMIN_PASSWORD and SMTP mailbox values

docker compose up -d
docker compose ps
```

## 3) First-time setup in web UI

1. Open http://<vps-ip>:8080 or https://mail.fcmanager.co.nz:8443.
2. Log in with POSTE_ADMIN / POSTE_ADMIN_PASSWORD.
3. Create mailboxes:
   - donotreply@fcmanager.co.nz
   - reports@fcmanager.co.nz
4. Set a strong password for reports@fcmanager.co.nz.

## 4) DNS records for fallback activation

At your DNS provider for fcmanager.co.nz:

- A: mail -> <your-vps-ip>
- MX: @ -> mail.fcmanager.co.nz (priority 10) only when failover is activated
- TXT SPF: @ -> v=spf1 mx a:mail.fcmanager.co.nz ~all
- TXT DMARC: _dmarc -> v=DMARC1; p=quarantine; rua=mailto:postmaster@fcmanager.co.nz
- DKIM: copy exact DKIM TXT record shown in Poste.io admin

## 5) Wire app stack secrets (failover mode)

After mailbox + DNS are ready, set these values everywhere:

- SMTP_HOST=mail.fcmanager.co.nz
- SMTP_PORT=587
- SMTP_USERNAME=reports@fcmanager.co.nz
- SMTP_PASSWORD=<reports mailbox password>
- SMTP_FROM_EMAIL=reports@fcmanager.co.nz
- SMTP_REPORTS_FROM_EMAIL=reports@fcmanager.co.nz

Use the script in scripts/wire-email-stack.sh to push these values to Supabase and GitHub secrets.

## 6) Validate SMTP from VPS

```bash
docker exec -it fcmanager-mta sh -lc 'postconf -n | head -n 30'
```

From any machine:

```bash
openssl s_client -starttls smtp -connect mail.fcmanager.co.nz:587 -crlf
```

Expected result: successful TLS handshake and SMTP banner.

## 7) Operational notes

- Keep 25/465/587/993 reachable from internet.
- Set VPS reverse DNS (PTR) to mail.fcmanager.co.nz in hPanel networking.
- Keep DKIM and DMARC aligned with the From domain.
- Back up ./data regularly.
