# Deploying Bite-Sized Golf to bsgolf.fun

How the live game gets from this repo to the custom domain **bsgolf.fun**
(registered at GoDaddy), and what to do when something breaks.

## How deployment works today

- Every push to the **`version2`** branch runs
  `.github/workflows/deploy.yml`: tests → `npm run build` → the `dist/`
  output is published to **GitHub Pages** (Settings → Pages → Source:
  "GitHub Actions").
- Vite builds with `base: './'` (all asset URLs relative), so the exact same
  build works at `https://mjohnsonwellabe.github.io/GolfModel/` **and** at a
  custom-domain root — no config change needed to move domains.
- `assets/` is the Vite public dir: everything in it is copied verbatim into
  `dist/`, so `assets/CNAME` (containing `bsgolf.fun`) lands at the root of
  every deploy. With Actions-based deploys the domain binding actually lives
  in Settings → Pages (the CNAME file is what keeps it bound on legacy
  branch-based deploys) — shipping the file is harmless today and future-
  proofs a switch back to branch deploys.

## One-time setup

### 1. GoDaddy DNS (bsgolf.fun)

In GoDaddy → My Products → bsgolf.fun → **DNS**, set:

| Type  | Name | Value                     | TTL    |
| ----- | ---- | ------------------------- | ------ |
| A     | @    | 185.199.108.153           | 1 hour |
| A     | @    | 185.199.109.153           | 1 hour |
| A     | @    | 185.199.110.153           | 1 hour |
| A     | @    | 185.199.111.153           | 1 hour |
| CNAME | www  | mjohnsonwellabe.github.io | 1 hour |

Those four A records are GitHub Pages' anycast IPs (all four, for
redundancy). Delete any conflicting records GoDaddy pre-creates — the
"Parked" A record and any "Forwarding" on the bare domain must go, or the
domain keeps landing on GoDaddy's parking page.

### 2. GitHub Pages custom domain

Repo → **Settings → Pages**:

1. Under "Custom domain", enter `bsgolf.fun` and Save. GitHub runs a DNS
   check (can take a few minutes after the DNS change propagates).
2. Once the check passes, tick **Enforce HTTPS**. The Let's Encrypt
   certificate is provisioned automatically; it can take up to an hour
   after the DNS check first passes.

The repo side is already done: `assets/CNAME` ships `bsgolf.fun` in every
build, which is what keeps the Settings → Pages binding from being wiped by
the next deploy.

### 3. Verify

- `https://bsgolf.fun` loads the game (hard-refresh to skip stale cache).
- `https://www.bsgolf.fun` redirects to the apex.
- `https://mjohnsonwellabe.github.io/GolfModel/` now 301s to bsgolf.fun
  (GitHub redirects the old URL automatically once a custom domain binds).
- Padlock is valid (HTTPS enforced).

DNS propagation is usually minutes but can take up to 48h from GoDaddy.
`dig bsgolf.fun +short` should list the four 185.199.x.153 IPs;
`dig www.bsgolf.fun +short` should show `mjohnsonwellabe.github.io`.

## Rollback / troubleshooting

- **Domain shows GoDaddy parking**: a parked A record or domain forwarding
  is still active in GoDaddy DNS — remove it.
- **"Domain's DNS record could not be retrieved" in Pages settings**: DNS
  hasn't propagated yet, or the A records are wrong. Re-check the table.
- **HTTPS cert stuck**: un-set and re-save the custom domain in Settings →
  Pages to re-trigger provisioning.
- **Bad deploy live**: revert the offending commit on `version2` and push —
  the workflow redeploys the previous good build in a few minutes. The
  domain binding is untouched by redeploys (CNAME ships in every build).
- **Back to github.io only**: delete `assets/CNAME`, push to `version2`,
  and clear the custom domain in Settings → Pages.
