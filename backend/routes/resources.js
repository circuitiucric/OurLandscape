const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const pdfDir = path.join(__dirname, "../public/pdf");
const coversDir = path.join(__dirname, "../public/pdf/covers");
const videoDir = path.join(__dirname, "../public/video");
if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

// Treat a non-cover upload as a video by mimetype or extension
const isVideoFile = (file) =>
  (file.mimetype && file.mimetype.startsWith("video/")) ||
  /\.(mp4|webm|mov|m4v|ogg)$/i.test(file.originalname);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "cover") return cb(null, coversDir);
    cb(null, isVideoFile(file) ? videoDir : pdfDir);
  },
  filename: (req, file, cb) => {
    const ext = file.fieldname === "cover" ? ".jpg" : path.extname(file.originalname);
    const base = path.basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 60);
    cb(null, `${file.fieldname === "cover" ? "cover" : "u"}-${Date.now()}-${base}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB ceiling for video
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "cover") return cb(null, true);
    const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
    cb(null, isPdf || isVideoFile(file));
  },
});
const uploadFields = upload.fields([{ name: "file", maxCount: 1 }, { name: "cover", maxCount: 1 }]);

const jwtSecret = process.env.JWT_SECRET;

// Auto-create required tables
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS resources (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type ENUM('pdf','video','post','notebook','external_link') NOT NULL,
        identifier VARCHAR(500) NOT NULL,
        title VARCHAR(500),
        cover_path VARCHAR(500) DEFAULT NULL,
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_type_identifier (type, identifier(255))
      ) CHARACTER SET utf8mb4
    `);
    try {
      await db.query("ALTER TABLE resources ADD COLUMN cover_path VARCHAR(500) DEFAULT NULL");
    } catch {}
    // Widen the type ENUM on pre-existing installs to include 'video'
    try {
      await db.query(
        "ALTER TABLE resources MODIFY COLUMN type ENUM('pdf','video','post','notebook','external_link') NOT NULL"
      );
    } catch {}

    await db.query(`
      CREATE TABLE IF NOT EXISTS reading_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_name VARCHAR(255) NOT NULL,
        resource_id INT NOT NULL,
        page_number INT DEFAULT 1,
        progress_percent FLOAT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        classified_page INT,
        classified_progress FLOAT,
        classified_at TIMESTAMP NULL,
        UNIQUE KEY uq_user_resource (user_name, resource_id),
        FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS recommendations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        resource_id INT NOT NULL,
        user_name VARCHAR(255) NOT NULL,
        primary_tag VARCHAR(100) NOT NULL,
        custom_name VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS resource_tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        resource_id INT NOT NULL,
        tag VARCHAR(100) NOT NULL,
        user_name VARCHAR(255),
        vote_score INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4
    `);

    try {
      await db.query("ALTER TABLE recommendations ADD COLUMN evaluation TEXT DEFAULT NULL");
    } catch {}

    console.log("[resources] Tables ready");
  } catch (err) {
    console.error("[resources] Table init failed:", err.message);
  }
})();

// Extract userName from JWT (returns null if absent/invalid)
const getUser = (req) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret).userName;
  } catch {
    return null;
  }
};

// POST /api/resources/upload  –  upload a PDF file (+ optional cover image)
router.post("/upload", uploadFields, async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const uploadedFile = req.files?.file?.[0];
  if (!uploadedFile) return res.status(400).json({ error: "No file uploaded" });
  const coverFile = req.files?.cover?.[0];
  const type = isVideoFile(uploadedFile) ? "video" : "pdf";
  const identifier = uploadedFile.filename;
  const title = req.body.title || uploadedFile.originalname;
  const coverPath = coverFile ? `/pdf/covers/${coverFile.filename}` : null;
  try {
    await db.query(
      "INSERT IGNORE INTO resources (type, identifier, title, cover_path, created_by) VALUES (?, ?, ?, ?, ?)",
      [type, identifier, title, coverPath, userName]
    );
    if (coverPath) {
      await db.query(
        "UPDATE resources SET cover_path = ? WHERE type = ? AND identifier = ?",
        [coverPath, type, identifier]
      );
    }
    const [rows] = await db.query(
      "SELECT * FROM resources WHERE type = ? AND identifier = ?",
      [type, identifier]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("[upload]", err);
    res.status(500).json({ error: "Failed to register uploaded file" });
  }
});

// POST /api/resources/register
// Idempotently register a resource and return its row.
router.post("/register", async (req, res) => {
  const { type, identifier, title } = req.body;
  const userName = getUser(req);
  if (!type || !identifier) {
    return res.status(400).json({ error: "type and identifier are required" });
  }
  try {
    await db.query(
      "INSERT IGNORE INTO resources (type, identifier, title, created_by) VALUES (?, ?, ?, ?)",
      [type, identifier, title || identifier, userName]
    );
    const [rows] = await db.query(
      "SELECT * FROM resources WHERE type = ? AND identifier = ?",
      [type, identifier]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("[register]", err);
    res.status(500).json({ error: "Failed to register resource" });
  }
});

// GET /api/resources/recommended
// All recommended resources, optionally filtered by primary_tag category.
router.get("/recommended", async (req, res) => {
  const { category } = req.query;
  try {
    let query = `
      SELECT
        r.id, r.type, r.identifier, r.title, r.created_at AS resource_created_at,
        rec.id AS rec_id, rec.primary_tag, rec.custom_name,
        rec.user_name AS recommender, rec.created_at AS recommended_at,
        COUNT(DISTINCT rh.user_name) AS viewer_count
      FROM resources r
      JOIN recommendations rec ON r.id = rec.resource_id
      LEFT JOIN reading_history rh ON r.id = rh.resource_id
    `;
    const params = [];
    if (category) {
      query += " WHERE rec.primary_tag = ?";
      params.push(category);
    }
    query += " GROUP BY r.id, rec.id ORDER BY rec.created_at DESC";
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("[recommended]", err);
    res.status(500).json({ error: "Failed to fetch recommendations" });
  }
});

// GET /api/resources/history
// Current user's full reading history, newest first.
router.get("/history", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  try {
    const [rows] = await db.query(
      `SELECT r.id, r.type, r.identifier, r.title,
              rh.page_number, rh.progress_percent, rh.updated_at,
              rh.classified_page, rh.classified_progress, rh.classified_at,
              EXISTS(
                SELECT 1 FROM recommendations rec
                WHERE rec.resource_id = r.id AND rec.user_name = ?
              ) AS is_recommended
       FROM reading_history rh
       JOIN resources r ON rh.resource_id = r.id
       WHERE rh.user_name = ?
       ORDER BY rh.updated_at DESC`,
      [userName, userName]
    );
    res.json(rows);
  } catch (err) {
    console.error("[history list]", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// GET /api/resources/discover
// All recommended resources with aggregated metadata. Optional ?category= filter.
router.get("/discover", async (req, res) => {
  const { category } = req.query;
  try {
    let resourceIds;
    if (category && category !== "全部") {
      const [catRows] = await db.query(
        "SELECT DISTINCT resource_id FROM recommendations WHERE primary_tag = ?",
        [category]
      );
      resourceIds = catRows.map((r) => r.resource_id);
    } else {
      const [allRows] = await db.query("SELECT DISTINCT resource_id FROM recommendations");
      resourceIds = allRows.map((r) => r.resource_id);
    }
    if (resourceIds.length === 0) return res.json([]);

    const ph = resourceIds.map(() => "?").join(",");

    const [resources] = await db.query(
      `SELECT r.id, r.type, r.identifier, r.title, r.cover_path,
              COUNT(DISTINCT rh.user_name) AS viewer_count
       FROM resources r
       LEFT JOIN reading_history rh ON r.id = rh.resource_id
       WHERE r.id IN (${ph})
       GROUP BY r.id`,
      resourceIds
    );

    const [recs] = await db.query(
      `SELECT resource_id, id AS rec_id, user_name, primary_tag, custom_name, evaluation, created_at
       FROM recommendations WHERE resource_id IN (${ph}) ORDER BY created_at DESC`,
      resourceIds
    );

    const [tags] = await db.query(
      `SELECT resource_id, tag, vote_score FROM resource_tags
       WHERE resource_id IN (${ph}) ORDER BY vote_score DESC`,
      resourceIds
    );

    const [connections] = await db.query(
      `SELECT ni.resource_id, nb.id AS board_id, nb.title AS board_title, nb.user_name
       FROM noteboard_items ni
       JOIN noteboards nb ON ni.noteboard_id = nb.id
       WHERE ni.resource_id IN (${ph}) AND ni.status = 'deployed'`,
      resourceIds
    );

    const annotationCounts = {};
    const pdfResources = resources.filter((r) => r.type === "pdf");
    if (pdfResources.length > 0) {
      const pdfIds = pdfResources.map((r) => r.id);
      const [annRows] = await db.query(
        `SELECT r.id AS resource_id, COUNT(a.annotation_id) AS cnt
         FROM resources r
         JOIN annotations a ON a.pdf_file = r.identifier
         WHERE r.id IN (${pdfIds.map(() => "?").join(",")})
         GROUP BY r.id`,
        pdfIds
      );
      annRows.forEach((row) => { annotationCounts[row.resource_id] = Number(row.cnt); });
    }
    const videoResources = resources.filter((r) => r.type === "video");
    if (videoResources.length > 0) {
      // Isolated so a missing video_file column (or future schema drift) only
      // costs us the count, instead of 500-ing the whole discover feed.
      try {
        const vidIds = videoResources.map((r) => r.id);
        const [annRows] = await db.query(
          `SELECT r.id AS resource_id, COUNT(a.annotation_id) AS cnt
           FROM resources r
           JOIN annotations a ON a.video_file = r.identifier
           WHERE r.id IN (${vidIds.map(() => "?").join(",")})
           GROUP BY r.id`,
          vidIds
        );
        annRows.forEach((row) => { annotationCounts[row.resource_id] = Number(row.cnt); });
      } catch (e) {
        console.error("[discover] video annotation count skipped:", e.code || e.message);
      }
    }

    const recMap = {};
    recs.forEach((r) => { (recMap[r.resource_id] = recMap[r.resource_id] || []).push(r); });
    const tagMap = {};
    tags.forEach((t) => { (tagMap[t.resource_id] = tagMap[t.resource_id] || []).push({ tag: t.tag, vote_score: t.vote_score }); });
    const connMap = {};
    connections.forEach((c) => {
      (connMap[c.resource_id] = connMap[c.resource_id] || []).push({
        board_id: c.board_id, board_title: c.board_title, user_name: c.user_name,
      });
    });

    const latestRec = {};
    recs.forEach((r) => {
      const t = new Date(r.created_at).getTime();
      if (!latestRec[r.resource_id] || t > latestRec[r.resource_id]) latestRec[r.resource_id] = t;
    });

    const result = resources
      .map((r) => {
        const recs = recMap[r.id] || [];
        const evalCount = recs.filter((rec) => rec.evaluation).length;
        return {
        id: r.id,
        type: r.type,
        identifier: r.identifier,
        title: r.title,
        cover_path: r.cover_path ?? null,
        viewer_count: Number(r.viewer_count),
        comment_count: (annotationCounts[r.id] || 0) + evalCount,
        recommendations: recs,
        tags: tagMap[r.id] || [],
        notebook_connections: connMap[r.id] || [],
        };
      })
      .sort((a, b) => (latestRec[b.id] || 0) - (latestRec[a.id] || 0));

    res.json(result);
  } catch (err) {
    console.error("[discover]", err);
    res.status(500).json({ error: "Failed to fetch discover feed" });
  }
});

// POST /api/resources/:id/history  –  upsert reading progress
router.post("/:id/history", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const resourceId = parseInt(req.params.id, 10);
  const { pageNumber, progressPercent } = req.body;
  try {
    await db.query(
      `INSERT INTO reading_history (user_name, resource_id, page_number, progress_percent)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         page_number = VALUES(page_number),
         progress_percent = VALUES(progress_percent),
         updated_at = CURRENT_TIMESTAMP`,
      [userName, resourceId, pageNumber ?? 1, progressPercent ?? 0]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[history save]", err);
    res.status(500).json({ error: "Failed to save progress" });
  }
});

// GET /api/resources/:id/history  –  get current user's progress for one resource
router.get("/:id/history", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const resourceId = parseInt(req.params.id, 10);
  try {
    const [rows] = await db.query(
      "SELECT * FROM reading_history WHERE user_name = ? AND resource_id = ?",
      [userName, resourceId]
    );
    res.json(rows[0] ?? null);
  } catch (err) {
    console.error("[history get]", err);
    res.status(500).json({ error: "Failed to fetch progress" });
  }
});

// POST /api/resources/:id/classify
// Snapshot the current reading position at classification time.
router.post("/:id/classify", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const resourceId = parseInt(req.params.id, 10);
  const { pageNumber, progressPercent } = req.body;
  try {
    await db.query(
      `INSERT INTO reading_history
         (user_name, resource_id, page_number, progress_percent,
          classified_page, classified_progress, classified_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         classified_page = VALUES(classified_page),
         classified_progress = VALUES(classified_progress),
         classified_at = NOW()`,
      [userName, resourceId,
       pageNumber ?? 1, progressPercent ?? 0,
       pageNumber ?? 1, progressPercent ?? 0]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[classify]", err);
    res.status(500).json({ error: "Failed to classify" });
  }
});

// POST /api/resources/:id/recommend  –  mark resource as recommended (can repeat)
router.post("/:id/recommend", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const resourceId = parseInt(req.params.id, 10);
  const { primaryTag, customName, evaluation } = req.body;
  if (!primaryTag) return res.status(400).json({ error: "primaryTag is required" });
  if (!evaluation || !String(evaluation).trim()) {
    return res.status(400).json({ error: "evaluation is required" });
  }
  try {
    const [result] = await db.query(
      "INSERT INTO recommendations (resource_id, user_name, primary_tag, custom_name, evaluation) VALUES (?, ?, ?, ?, ?)",
      [resourceId, userName, primaryTag, customName ?? null, String(evaluation).trim()]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error("[recommend]", err);
    res.status(500).json({ error: "Failed to recommend" });
  }
});

// GET /api/resources/:id/recommend  –  check recommendation status
router.get("/:id/recommend", async (req, res) => {
  const resourceId = parseInt(req.params.id, 10);
  try {
    const [rows] = await db.query(
      "SELECT user_name, primary_tag, custom_name, created_at FROM recommendations WHERE resource_id = ?",
      [resourceId]
    );
    res.json({ recommended: rows.length > 0, recommendations: rows });
  } catch (err) {
    console.error("[check recommend]", err);
    res.status(500).json({ error: "Failed to check" });
  }
});

// POST /api/resources/:id/tags  –  add tags to a resource
router.post("/:id/tags", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const resourceId = parseInt(req.params.id, 10);
  const { tags } = req.body;
  if (!Array.isArray(tags) || tags.length === 0) return res.status(400).json({ error: "tags array required" });
  try {
    for (const tag of tags) {
      if (!tag.trim()) continue;
      await db.query(
        "INSERT IGNORE INTO resource_tags (resource_id, tag, user_name) VALUES (?, ?, ?)",
        [resourceId, tag.trim(), userName]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[add tags]", err);
    res.status(500).json({ error: "Failed to add tags" });
  }
});

// GET /api/resources/:id/viewers  –  list of usernames who have read this resource
router.get("/:id/viewers", async (req, res) => {
  const resourceId = parseInt(req.params.id, 10);
  try {
    const [rows] = await db.query(
      "SELECT user_name FROM reading_history WHERE resource_id = ?",
      [resourceId]
    );
    res.json(rows.map((r) => r.user_name));
  } catch (err) {
    console.error("[viewers]", err);
    res.status(500).json({ error: "Failed to fetch viewers" });
  }
});

module.exports = router;
