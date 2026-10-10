
"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SECRET = process.env.VOTE_SECRET || process.env.SALT || "change-me";

const DATABASE_URL = process.env.DATABASE_URL;
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;

const defaults = [
  ["nadia", "Nadia"],
  ["shahd-mahmoud", "Shahd Mahmoud"],
  ["shahd-gaber", "Shahd Gaber"],
  ["nervan", "Nervan"],
  ["rawan-adel", "Rawan Adel"],
  ["mai", "Mai"],
  ["roaa", "Roaa"],
  ["rawan-mohamed", "Rawan Mohamed"],
  ["elaf", "Elaf"],
  ["rawan-salah", "Rawan Salah"],
  ["manar", "Manar"]
].map(([id, name], i) => ({
  id,
  name,
  n: i + 1,
  photo: `/photos/${id}.jpeg`
}));

// Initialize persistent database
let initPromise;

async function initializeDatabase() {
  if (!sql) {
    throw new Error("DATABASE_URL is missing.");
  }

  await sql`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      n INTEGER NOT NULL,
      photo TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS votes (
      dev TEXT PRIMARY KEY,
      cid TEXT NOT NULL,
      ip TEXT NOT NULL,
      t BIGINT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS visitors (
      dev TEXT PRIMARY KEY
    )
  `;

  for (const candidate of defaults) {
    await sql`
      INSERT INTO candidates (id, name, n, photo)
      VALUES (
        ${candidate.id},
        ${candidate.name},
        ${candidate.n},
        ${candidate.photo}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
}

function ready() {
  if (!initPromise) {
    initPromise = initializeDatabase().catch(error => {
      initPromise = null;
      throw error;
    });
  }

  return initPromise;
}

function hash(value) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(String(value))
    .digest("hex")
    .slice(0, 32);
}

function cookie(req, name) {
  const match = (req.headers.cookie || "").match(
    new RegExp("(?:^|;\\s*)" + name + "=([^;]+)")
  );

  return match ? decodeURIComponent(match[1]) : null;
}

// Identify voting device
app.use((req, res, next) => {
  let device = cookie(req, "gtb");

  if (!device || !/^[a-f0-9-]{36}$/i.test(device)) {
    device = crypto.randomUUID();

    const secure =
      req.secure ||
      req.get("x-forwarded-proto") === "https";

    res.setHeader(
      "Set-Cookie",
      `gtb=${device}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${
        secure ? "; Secure" : ""
      }`
    );
  }

  req.device = device;
  req.network = hash(req.ip || "unknown");
  next();
});

// Async error wrapper
function route(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// Get state from Neon
async function publicState(req) {
  await ready();

  const [candidates, counts, totals, own] = await Promise.all([
    sql`
      SELECT id, name, n, photo
      FROM candidates
      ORDER BY n ASC
    `,
    sql`
      SELECT cid, COUNT(*)::integer AS votes
      FROM votes
      GROUP BY cid
    `,
    sql`
      SELECT COUNT(*)::integer AS total
      FROM votes
    `,
    sql`
      SELECT cid
      FROM votes
      WHERE dev = ${req.device}
      LIMIT 1
    `
  ]);

  const voteCounts = new Map(
    counts.map(row => [row.cid, Number(row.votes)])
  );

  const candidateList = candidates.map(c => ({
    id: c.id,
    name: c.name,
    n: Number(c.n),
    photo: c.photo,
    votes: voteCounts.get(c.id) || 0
  }));

  return {
    candidates: candidateList,
    total: Number(totals[0]?.total || 0),
    voted: own.length > 0,
    myVote: own[0]?.cid || null
  };
}

// Homepage
app.get("/", (req, res) => {
  const file = path.join(PUBLIC, "index.html");
  const html = fs.readFileSync(file, "utf8");

  const base = `${req.protocol}://${req.get("host")}`;

  res
    .type("html")
    .set("Cache-Control", "no-store")
    .send(html.replace(/__BASE__/g, base));
});

// Public state and visitor tracking
app.get("/api/state", route(async (req, res) => {
  await ready();

  await sql`
    INSERT INTO visitors (dev)
    VALUES (${req.device})
    ON CONFLICT (dev) DO NOTHING
  `;

  res
    .set("Cache-Control", "no-store")
    .json(await publicState(req));
}));

// Vote or change existing vote
app.post("/api/vote", route(async (req, res) => {
  await ready();

  const id = req.body?.id;

  if (!defaults.some(c => c.id === id)) {
    return res.status(400).json({
      error: "Invalid candidate."
    });
  }

  const existing = await sql`
    SELECT cid
    FROM votes
    WHERE dev = ${req.device}
    LIMIT 1
  `;

  if (existing.length) {
    await sql`
      UPDATE votes
      SET cid = ${id}, t = ${Date.now()}
      WHERE dev = ${req.device}
    `;

    return res.json({
      ok: true,
      changed: true,
      ...await publicState(req)
    });
  }

  const networkVotes = await sql`
    SELECT COUNT(*)::integer AS count
    FROM votes
    WHERE ip = ${req.network}
  `;

  if (Number(networkVotes[0].count) >= 3) {
    return res.status(429).json({
      error: "Voting limit reached for this network."
    });
  }

  // A unique device ID prevents duplicate rows.
  const inserted = await sql`
    INSERT INTO votes (dev, cid, ip, t)
    VALUES (
      ${req.device},
      ${id},
      ${req.network},
      ${Date.now()}
    )
    ON CONFLICT (dev) DO NOTHING
    RETURNING dev
  `;

  res.json({
    ok: true,
    changed: inserted.length === 0,
    ...await publicState(req)
  });
}));

// Admin authentication
function adminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error: "Set ADMIN_PASSWORD on the server."
    });
  }

  const provided = Buffer.from(req.get("x-admin") || "");
  const expected = Buffer.from(ADMIN_PASSWORD);

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return res.status(401).json({
      error: "Wrong password."
    });
  }

  next();
}

// Admin dashboard state
app.get("/api/admin", adminAuth, route(async (req, res) => {
  await ready();

  const visitors = await sql`
    SELECT COUNT(*)::integer AS count
    FROM visitors
  `;

  res.json({
    ...await publicState(req),
    visitors: Number(visitors[0].count)
  });
}));

// Update candidate details
app.put(
  "/api/admin/candidate/:id",
  adminAuth,
  route(async (req, res) => {
    await ready();

    const id = req.params.id;

    if (!defaults.some(c => c.id === id)) {
      return res.status(404).json({
        error: "Not found."
      });
    }

    const name = String(req.body?.name || "").trim();
    const photo = String(req.body?.photo || "").trim();

    if (!name || name.length > 100) {
      return res.status(400).json({
        error: "Invalid name."
      });
    }

    if (
      !/^\/photos\/[a-zA-Z0-9._-]+\.(jpeg|jpg|png|webp)$/i.test(photo) ||
      photo.includes("..")
    ) {
      return res.status(400).json({
        error: "Use a valid /photos/ image path."
      });
    }

    const result = await sql`
      UPDATE candidates
      SET name = ${name}, photo = ${photo}
      WHERE id = ${id}
      RETURNING id, name, n, photo
    `;

    if (!result.length) {
      return res.status(404).json({
        error: "Not found."
      });
    }

    res.json({
      ok: true,
      candidate: {
        ...result[0],
        label: "",
        clue: ""
      }
    });
  })
);

// Reset all votes
app.post(
  "/api/admin/reset",
  adminAuth,
  route(async (req, res) => {
    await ready();

    await sql`DELETE FROM votes`;

    res.json({ ok: true });
  })
);

// Export results
app.get(
  "/api/admin/export",
  adminAuth,
  route(async (req, res) => {
    const state = await publicState(req);

    const rows = state.candidates.sort(
      (a, b) => b.votes - a.votes
    );

    const csv = [
      "rank,name,votes",
      ...rows.map((c, i) =>
        `${i + 1},"${c.name.replace(/"/g, '""')}",${c.votes}`
      )
    ].join("\r\n");

    res
      .type("text/csv")
      .set(
        "Content-Disposition",
        'attachment; filename="bride-results.csv"'
      )
      .send(csv);
  })
);

// Admin page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC, "admin.html"));
});

// Static assets
app.use(express.static(PUBLIC, {
  index: false,
  setHeaders: (res, filePath) => {
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

// 404
app.use((req, res) => {
  res.status(404).send("Not found");
});

// Error handling
app.use((err, req, res, next) => {
  console.error("Server error:", err);

  res.status(500).json({
    error: "Server error. Please try again."
  });
});

// Run locally and export for Vercel
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Guess the Bride: http://localhost:${PORT}`);
  });
}

module.exports = app;
