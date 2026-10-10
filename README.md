# 💻💍 Guess The Bride
Express + JSON database. No bride identity is stored anywhere in code/data.

## Photos
Put the 11 photos in `public/photos/` named exactly:
nadia.jpg, shahd-mahmoud.jpg, shahd-gaber.jpg, nervan.jpg, rawan-adel.jpg, mai.jpg, roaa.jpg, rawan-mohamed.jpg, elaf.jpg, rawan-salah.jpg, manar.jpg
(Missing photos fall back to an initial. Compress to ~800px wide for fast loading.)

## Run locally
npm install && ADMIN_PASSWORD=choose-one npm start  → http://localhost:3000  (admin: /admin)

## Deploy (Render.com, free-ish, gives a public URL)
1. Push this folder to a GitHub repo.
2. Render → New Web Service → pick repo. Build: `npm install`, Start: `npm start`.
3. Env vars: `ADMIN_PASSWORD` (required), `SALT` (any random text).
4. Votes live in `DATA_DIR/db.json`: add a Persistent Disk (mount /var/data) and set `DATA_DIR=/var/data`, otherwise votes reset on redeploy.
Railway/Fly.io work the same (attach a volume, set DATA_DIR).

## Anti-cheat
One vote per device cookie + max 3 per hashed IP (so shared WiFi still works). Clearing cookies on a new network can bypass it — "reasonable", not bulletproof.
