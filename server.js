
"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

const PORT = Number(process.env.PORT || 3000);

const PUBLIC = path.join(__dirname, "public");
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA, "db.json");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SECRET =
  process.env.VOTE_SECRET ||
  process.env.SALT ||
  "change-me";

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
  photo: `/photos/${id}.jpeg`,
  label: "",
  clue: ""
}));

// Database initialization
// NOTE: Local JSON storage is not persistent on Vercel.

const IS_VERCEL = Boolean(process.env.VERCEL);

if (!IS_VERCEL) {
  fs.mkdirSync(DATA, { recursive: true });
}

let db;

if (fs.existsSync(DB_PATH)) {
  db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
} else {
  db = {
    candidates: [],
    votes: [],
    visitors: []
  };
}

if (!Array.isArray(db.candidates)) db.candidates = [];
if (!Array.isArray(db.votes)) db.votes = [];
if (!Array.isArray(db.visitors)) db.visitors = [];

for (const item of defaults) {
  const existing = db.candidates.find(
    c => c.id === item.id
  );

  if (!existing) {
    db.candidates.push({ ...item });
  } else {
    if (!existing.name) existing.name = item.name;
    if (!existing.photo) existing.photo = item.photo;

    existing.n = item.n;
    existing.label = "";
    existing.clue = "";
  }
}

function save() {
  if (IS_VERCEL) {
    throw new Error(
      "Persistent database required on Vercel. Configure external storage before enabling voting."
    );
  }

  const tmp = DB_PATH + ".tmp";

  fs.writeFileSync(
    tmp,
    JSON.stringify(db, null, 2)
  );

  fs.renameSync(tmp, DB_PATH);
}

if (!IS_VERCEL) {
  save();
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
    new RegExp(
      "(?:^|;\\s*)" + name + "=([^;]+)"
    )
  );

  return match
    ? decodeURIComponent(match[1])
    : null;
}

// Device identification
app.use((req, res, next) => {
  let device = cookie(req, "gtb");

  if (
    !device ||
    !/^[a-f0-9-]{36}$/i.test(device)
  ) {
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

function ownVote(req) {
  return db.votes.find(
    v => v.dev === req.device
  );
}

function publicState(req) {
  const counts = Object.create(null);

  for (const v of db.votes) {
    counts[v.cid] = (counts[v.cid] || 0) + 1;
  }

  const vote = ownVote(req);

  const candidates = defaults.map(def => {
    const c = db.candidates.find(
      x => x.id === def.id
    ) || def;

    return {
      id: c.id,
      name: c.name,
      n: def.n,
      photo: c.photo,
      votes: counts[c.id] || 0
    };
  });

  return {
    candidates,
    total: db.votes.length,
    voted: Boolean(vote),
    myVote: vote ? vote.cid : null
  };
}

// Homepage
app.get("/", (req, res) => {
  const file = path.join(
    PUBLIC,
    "index.html"
  );

  const html = fs.readFileSync(
    file,
    "utf8"
  );

  const base =
    `${req.protocol}://${req.get("host")}`;

  res
    .type("html")
    .set("Cache-Control", "no-store")
    .send(
      html.replace(/__BASE__/g, base)
    );
});

// Public state
app.get("/api/state", (req, res) => {
  if (!db.visitors.includes(req.device)) {
    if (!IS_VERCEL) {
      db.visitors.push(req.device);
      save();
    }
  }

  res
    .set("Cache-Control", "no-store")
    .json(publicState(req));
});

// Voting
app.post("/api/vote", (req, res) => {
  if (IS_VERCEL) {
    return res.status(503).json({
      error:
        "Voting is unavailable until a persistent database is configured."
    });
  }

  const id = req.body?.id;

  if (!defaults.some(c => c.id === id)) {
    return res.status(400).json({
      error: "Invalid candidate."
    });
  }

  const existing = ownVote(req);

  if (existing) {
    // Changing a vote does not increase total votes.
    existing.cid = id;
    existing.t = Date.now();

    save();

    return res.json({
      ok: true,
      changed: true,
      ...publicState(req)
    });
  }

  const networkVotes = db.votes.filter(
    v => v.ip === req.network
  ).length;

  if (networkVotes >= 3) {
    return res.status(429).json({
      error:
        "Voting limit reached for this network."
    });
  }

  db.votes.push({
    cid: id,
    dev: req.device,
    ip: req.network,
    t: Date.now()
  });

  save();

  res.json({
    ok: true,
    changed: false,
    ...publicState(req)
  });
});

// Admin authentication
function adminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error:
        "Set ADMIN_PASSWORD on the server."
    });
  }

  const provided = Buffer.from(
    req.get("x-admin") || ""
  );

  const expected = Buffer.from(
    ADMIN_PASSWORD
  );

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(
      provided,
      expected
    )
  ) {
    return res.status(401).json({
      error: "Wrong password."
    });
  }

  next();
}

// Admin state
app.get(
  "/api/admin",
  adminAuth,
  (req, res) => {
    res.json({
      ...publicState(req),
      visitors: db.visitors.length
    });
  }
);

// Update candidate
app.put(
  "/api/admin/candidate/:id",
  adminAuth,
  (req, res) => {
    if (IS_VERCEL) {
      return res.status(503).json({
        error:
          "Editing requires a persistent database on Vercel."
      });
    }

    const c = db.candidates.find(
      x => x.id === req.params.id
    );

    if (
      !c ||
      !defaults.some(x => x.id === c.id)
    ) {
      return res.status(404).json({
        error: "Not found."
      });
    }

    const name = String(
      req.body?.name || ""
    ).trim();

    const photo = String(
      req.body?.photo || ""
    ).trim();

    if (!name || name.length > 100) {
      return res.status(400).json({
        error: "Invalid name."
      });
    }

    if (
      !photo.startsWith("/photos/") ||
      photo.includes("..") ||
      photo.includes("\\") ||
      photo.length > 300
    ) {
      return res.status(400).json({
        error:
          "Use a photo path such as /photos/nadia.jpeg"
      });
    }

    c.name = name;
    c.photo = photo;
    c.label = "";
    c.clue = "";

    save();

    res.json({
      ok: true,
      candidate: c
    });
  }
);

// Reset votes
app.post(
  "/api/admin/reset",
  adminAuth,
  (req, res) => {
    if (IS_VERCEL) {
      return res.status(503).json({
        error:
          "Reset requires a persistent database on Vercel."
      });
    }

    db.votes = [];

    save();

    res.json({
      ok: true
    });
  }
);

// Export results
app.get(
  "/api/admin/export",
  adminAuth,
  (req, res) => {
    const rows = publicState(req)
      .candidates
      .sort(
        (a, b) => b.votes - a.votes
      );

    const csv = [
      "rank,name,votes",
      ...rows.map(
        (c, i) =>
          `${i + 1},"${c.name.replace(
            /"/g,
            '""'
          )}",${c.votes}`
      )
    ].join("\r\n");

    res
      .type("text/csv")
      .set(
        "Content-Disposition",
        'attachment; filename="bride-results.csv"'
      )
      .send(csv);
  }
);

// Admin page
app.get("/admin", (req, res) => {
  res.sendFile(
    path.join(PUBLIC, "admin.html")
  );
});

// Static assets
app.use(
  express.static(PUBLIC, {
    index: false,
    setHeaders: (res, filePath) => {
      if (
        /\.(jpg|jpeg|png|webp|gif)$/i.test(
          filePath
        )
      ) {
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate"
        );

        res.setHeader(
          "Pragma",
          "no-cache"
        );

        res.setHeader(
          "Expires",
          "0"
        );
      }
    }
  })
);

// 404
app.use((req, res) => {
  res.status(404).send("Not found");
});

// Local development + Vercel support
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `Guess the Bride: http://localhost:${PORT}`
    );
  });
}

module.exports = app;
