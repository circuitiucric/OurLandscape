const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const jwtSecret = process.env.JWT_SECRET;

// Auto-create tables
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS noteboards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_name VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL DEFAULT '未命名笔记板',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) CHARACTER SET utf8mb4
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS noteboard_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        noteboard_id INT NOT NULL,
        item_type ENUM('pdf','thread','annotation','video','webpage','text_note') NOT NULL,
        resource_id INT,
        text_content TEXT,
        title VARCHAR(500),
        status ENUM('pending','deployed') NOT NULL DEFAULT 'pending',
        group_index INT NOT NULL DEFAULT 0,
        col INT NOT NULL DEFAULT 0,
        row_index INT NOT NULL DEFAULT 0,
        w INT NOT NULL DEFAULT 5,
        h INT NOT NULL DEFAULT 3,
        reading_progress JSON,
        note_text TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (noteboard_id) REFERENCES noteboards(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4
    `);
    try { await db.query("ALTER TABLE noteboard_items ADD COLUMN note_text TEXT DEFAULT NULL"); } catch {}

    // Public/private visibility — boards are public by default; only public boards
    // can be browsed/selected by others.
    try { await db.query("ALTER TABLE noteboards ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 1"); } catch {}
    try { await db.query("ALTER TABLE noteboards ALTER COLUMN is_public SET DEFAULT 1"); } catch {}

    // Clips — a bundle of items copied (framed-selected) from another user's public board
    await db.query(`
      CREATE TABLE IF NOT EXISTS noteboard_clips (
        id INT AUTO_INCREMENT PRIMARY KEY,
        noteboard_id INT NOT NULL,
        source_board_id INT,
        source_user VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (noteboard_id) REFERENCES noteboards(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4
    `);
    // Provenance / lock columns on items belonging to a clip
    try { await db.query("ALTER TABLE noteboard_items ADD COLUMN clip_id INT DEFAULT NULL"); } catch {}
    try { await db.query("ALTER TABLE noteboard_items ADD COLUMN locked TINYINT(1) NOT NULL DEFAULT 0"); } catch {}
    try { await db.query("ALTER TABLE noteboard_items ADD COLUMN clip_dx INT NOT NULL DEFAULT 0"); } catch {}
    try { await db.query("ALTER TABLE noteboard_items ADD COLUMN clip_dy INT NOT NULL DEFAULT 0"); } catch {}

    await db.query(`
      CREATE TABLE IF NOT EXISTS noteboard_connections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        noteboard_id INT NOT NULL,
        from_item_id INT NOT NULL,
        to_item_id INT NOT NULL,
        line_type ENUM('straight','curved') NOT NULL DEFAULT 'straight',
        label VARCHAR(255),
        ctrl_x FLOAT DEFAULT NULL,
        ctrl_y FLOAT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (noteboard_id) REFERENCES noteboards(id) ON DELETE CASCADE,
        FOREIGN KEY (from_item_id) REFERENCES noteboard_items(id) ON DELETE CASCADE,
        FOREIGN KEY (to_item_id) REFERENCES noteboard_items(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4
    `);

    // Migrate existing connections table — add ctrl columns if absent
    try { await db.query("ALTER TABLE noteboard_connections ADD COLUMN ctrl_x FLOAT DEFAULT NULL"); } catch {}
    try { await db.query("ALTER TABLE noteboard_connections ADD COLUMN ctrl_y FLOAT DEFAULT NULL"); } catch {}

    // Fix existing PDF items that were stored with wrong landscape dimensions
    await db.query(
      "UPDATE noteboard_items SET w=3, h=5 WHERE item_type='pdf' AND w=5 AND h=3"
    );
    console.log("[noteboards] Tables ready");
  } catch (err) {
    console.error("[noteboards] Table init failed:", err.message);
  }
})();

const getUser = (req) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret).userName;
  } catch {
    return null;
  }
};

// ── Noteboard CRUD ────────────────────────────────────────────────────────────

// GET /api/noteboards  –  list current user's noteboards
router.get("/", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  try {
    const [rows] = await db.query(
      "SELECT * FROM noteboards WHERE user_name = ? ORDER BY updated_at DESC",
      [userName]
    );
    res.json(rows);
  } catch (err) {
    console.error("[noteboards list]", err);
    res.status(500).json({ error: "Failed to fetch noteboards" });
  }
});

// POST /api/noteboards  –  create a new noteboard
router.post("/", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const { title, description, is_public } = req.body;
  try {
    const [result] = await db.query(
      "INSERT INTO noteboards (user_name, title, description, is_public) VALUES (?, ?, ?, ?)",
      [userName, title || "未命名笔记板", description || null, is_public === undefined ? 1 : (is_public ? 1 : 0)]
    );
    const [rows] = await db.query("SELECT * FROM noteboards WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("[noteboards create]", err);
    res.status(500).json({ error: "Failed to create noteboard" });
  }
});

// GET /api/noteboards/deployments  –  which deployed noteboard items reference a resource
// ?item_type=pdf&identifier=file.pdf   (PDF, looked up by filename)
// ?item_type=annotation&resource_id=N  (annotation / thread floor)
router.get("/deployments", async (req, res) => {
  const { item_type, resource_id, identifier } = req.query;
  if (!item_type) return res.status(400).json({ error: "item_type required" });
  try {
    let rows;
    if (identifier) {
      [rows] = await db.query(
        `SELECT nb.id AS board_id, nb.title AS board_title, nb.user_name,
                ni.reading_progress, ni.note_text, ni.text_content
         FROM noteboard_items ni
         JOIN noteboards nb ON ni.noteboard_id = nb.id
         JOIN resources r  ON ni.resource_id  = r.id
         WHERE ni.status = 'deployed' AND ni.item_type = ? AND r.identifier = ?`,
        [item_type, identifier]
      );
    } else {
      [rows] = await db.query(
        `SELECT nb.id AS board_id, nb.title AS board_title, nb.user_name,
                ni.reading_progress, ni.note_text, ni.text_content
         FROM noteboard_items ni
         JOIN noteboards nb ON ni.noteboard_id = nb.id
         WHERE ni.status = 'deployed' AND ni.item_type = ? AND ni.resource_id = ?`,
        [item_type, resource_id]
      );
    }
    res.json(rows);
  } catch (err) {
    console.error("[deployments]", err);
    res.status(500).json({ error: "Failed to fetch deployments" });
  }
});

// GET /api/noteboards/:id  –  full noteboard with items and connections
router.get("/:id", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const id = parseInt(req.params.id, 10);
  try {
    const [[board]] = await db.query("SELECT * FROM noteboards WHERE id = ?", [id]);
    if (!board) return res.status(404).json({ error: "Not found" });

    const isOwner = board.user_name === userName;
    // Non-owners may only read public boards
    if (!isOwner && !board.is_public) return res.status(403).json({ error: "Forbidden" });

    // Register this noteboard as a station-internal resource and record the
    // current view in the viewer's reading history (so noteboards appear in
    // the 动态历史 / browsing-history feed, like PDFs do). Never let this
    // bookkeeping break board loading.
    let resourceId = null;
    try {
      await db.query(
        `INSERT INTO resources (type, identifier, title, created_by)
         VALUES ('notebook', ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title)`,
        [String(id), board.title, board.user_name]
      );
      const [[resRow]] = await db.query(
        "SELECT id FROM resources WHERE type = 'notebook' AND identifier = ?",
        [String(id)]
      );
      if (resRow) {
        resourceId = resRow.id;
        await db.query(
          `INSERT INTO reading_history (user_name, resource_id)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
          [userName, resRow.id]
        );
      }
    } catch (e) {
      console.error("[noteboards view-history]", e.message);
    }

    const [items] = await db.query(
      `SELECT ni.*, r.identifier AS resource_identifier
       FROM noteboard_items ni
       LEFT JOIN resources r ON ni.resource_id = r.id
       WHERE ni.noteboard_id = ?
       ORDER BY ni.group_index, ni.row_index, ni.col`,
      [id]
    );
    const [connections] = await db.query(
      "SELECT * FROM noteboard_connections WHERE noteboard_id = ?",
      [id]
    );
    const [clips] = await db.query(
      "SELECT * FROM noteboard_clips WHERE noteboard_id = ?",
      [id]
    );

    // Ensure reading_progress is always a parsed object, never a raw JSON string
    const parseRP = (rp) => {
      if (!rp) return null;
      if (typeof rp === "string") { try { return JSON.parse(rp); } catch { return null; } }
      return rp;
    };
    const normalizedItems = items.map(item => ({
      ...item,
      reading_progress: parseRP(item.reading_progress),
    }));

    res.json({ ...board, editable: isOwner, resource_id: resourceId, items: normalizedItems, connections, clips });
  } catch (err) {
    console.error("[noteboards get]", err);
    res.status(500).json({ error: "Failed to fetch noteboard" });
  }
});

// PUT /api/noteboards/:id  –  update title / description
router.put("/:id", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const id = parseInt(req.params.id, 10);
  const { title, description, is_public } = req.body;
  try {
    const [result] = await db.query(
      `UPDATE noteboards SET
         title = COALESCE(?, title),
         description = COALESCE(?, description),
         is_public = COALESCE(?, is_public)
       WHERE id = ? AND user_name = ?`,
      [title ?? null, description ?? null,
       is_public === undefined ? null : (is_public ? 1 : 0),
       id, userName]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[noteboards update]", err);
    res.status(500).json({ error: "Failed to update noteboard" });
  }
});

// DELETE /api/noteboards/:id
router.delete("/:id", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const id = parseInt(req.params.id, 10);
  try {
    const [result] = await db.query(
      "DELETE FROM noteboards WHERE id = ? AND user_name = ?",
      [id, userName]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[noteboards delete]", err);
    res.status(500).json({ error: "Failed to delete noteboard" });
  }
});

// ── Items ─────────────────────────────────────────────────────────────────────

// POST /api/noteboards/:id/items  –  add item (initially pending)
router.post("/:id/items", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const notebookId = parseInt(req.params.id, 10);
  const { item_type, resource_id, text_content, title, w, h, reading_progress, note_text } = req.body;
  if (!item_type) return res.status(400).json({ error: "item_type is required" });

  const defaultSizes = { pdf: [3,5], thread: [5,3], annotation: [5,2], video: [6,4], webpage: [5,3], text_note: [4,2] };
  const [dw, dh] = defaultSizes[item_type] ?? [5, 3];

  try {
    const [[board]] = await db.query(
      "SELECT id FROM noteboards WHERE id = ? AND user_name = ?",
      [notebookId, userName]
    );
    if (!board) return res.status(404).json({ error: "Noteboard not found" });

    const [result] = await db.query(
      `INSERT INTO noteboard_items
         (noteboard_id, item_type, resource_id, text_content, title, w, h, reading_progress, note_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [notebookId, item_type, resource_id ?? null, text_content ?? null,
       title ?? null, w ?? dw, h ?? dh,
       reading_progress ? JSON.stringify(reading_progress) : null,
       note_text ?? null]
    );
    const [[item]] = await db.query("SELECT * FROM noteboard_items WHERE id = ?", [result.insertId]);
    res.status(201).json(item);
  } catch (err) {
    console.error("[items create]", err);
    res.status(500).json({ error: "Failed to add item" });
  }
});

// PUT /api/noteboards/:id/items/:itemId  –  update position, size, content
router.put("/:id/items/:itemId", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const notebookId = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  const { group_index, col, row_index, w, h, text_content, title, reading_progress } = req.body;

  try {
    const [[board]] = await db.query(
      "SELECT id FROM noteboards WHERE id = ? AND user_name = ?",
      [notebookId, userName]
    );
    if (!board) return res.status(404).json({ error: "Noteboard not found" });

    await db.query(
      `UPDATE noteboard_items SET
        group_index    = COALESCE(?, group_index),
        col            = COALESCE(?, col),
        row_index      = COALESCE(?, row_index),
        w              = COALESCE(?, w),
        h              = COALESCE(?, h),
        text_content   = COALESCE(?, text_content),
        title          = COALESCE(?, title),
        reading_progress = COALESCE(?, reading_progress)
       WHERE id = ? AND noteboard_id = ? AND locked = 0`,
      [group_index ?? null, col ?? null, row_index ?? null,
       w ?? null, h ?? null, text_content ?? null, title ?? null,
       reading_progress ? JSON.stringify(reading_progress) : null,
       itemId, notebookId]
    );
    // (locked clip items are repositioned via the clip endpoints, not here)
    res.json({ success: true });
  } catch (err) {
    console.error("[items update]", err);
    res.status(500).json({ error: "Failed to update item" });
  }
});

// PATCH /api/noteboards/:id/items/:itemId/deploy  –  move item from pending → deployed
router.patch("/:id/items/:itemId/deploy", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const notebookId = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  const { group_index, col, row_index } = req.body;

  try {
    const [[board]] = await db.query(
      "SELECT id FROM noteboards WHERE id = ? AND user_name = ?",
      [notebookId, userName]
    );
    if (!board) return res.status(404).json({ error: "Noteboard not found" });

    await db.query(
      `UPDATE noteboard_items
       SET status = 'deployed',
           group_index = COALESCE(?, group_index),
           col = COALESCE(?, col),
           row_index = COALESCE(?, row_index)
       WHERE id = ? AND noteboard_id = ? AND locked = 0`,
      [group_index ?? null, col ?? null, row_index ?? null, itemId, notebookId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[items deploy]", err);
    res.status(500).json({ error: "Failed to deploy item" });
  }
});

// DELETE /api/noteboards/:id/items/:itemId
router.delete("/:id/items/:itemId", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const notebookId = parseInt(req.params.id, 10);
  const itemId = parseInt(req.params.itemId, 10);
  try {
    const [[board]] = await db.query(
      "SELECT id FROM noteboards WHERE id = ? AND user_name = ?",
      [notebookId, userName]
    );
    if (!board) return res.status(404).json({ error: "Noteboard not found" });

    await db.query(
      "DELETE FROM noteboard_items WHERE id = ? AND noteboard_id = ? AND locked = 0",
      [itemId, notebookId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[items delete]", err);
    res.status(500).json({ error: "Failed to delete item" });
  }
});

// ── Connections ───────────────────────────────────────────────────────────────

// POST /api/noteboards/:id/connections  –  draw a line between two items (cross-group ok)
router.post("/:id/connections", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const notebookId = parseInt(req.params.id, 10);
  const { from_item_id, to_item_id, line_type, label, ctrl_x, ctrl_y } = req.body;
  if (!from_item_id || !to_item_id) {
    return res.status(400).json({ error: "from_item_id and to_item_id are required" });
  }
  try {
    const [[board]] = await db.query(
      "SELECT id FROM noteboards WHERE id = ? AND user_name = ?",
      [notebookId, userName]
    );
    if (!board) return res.status(404).json({ error: "Noteboard not found" });

    const [result] = await db.query(
      `INSERT INTO noteboard_connections (noteboard_id, from_item_id, to_item_id, line_type, label, ctrl_x, ctrl_y)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [notebookId, from_item_id, to_item_id, line_type || "straight", label ?? null, ctrl_x ?? null, ctrl_y ?? null]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error("[connections create]", err);
    res.status(500).json({ error: "Failed to create connection" });
  }
});

// PATCH /api/noteboards/:id/connections/:connId  –  update line_type / ctrl_x / ctrl_y
router.patch("/:id/connections/:connId", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const notebookId = parseInt(req.params.id, 10);
  const connId = parseInt(req.params.connId, 10);
  const { line_type, ctrl_x, ctrl_y } = req.body;
  try {
    const [[board]] = await db.query(
      "SELECT id FROM noteboards WHERE id = ? AND user_name = ?",
      [notebookId, userName]
    );
    if (!board) return res.status(404).json({ error: "Noteboard not found" });
    const updates = [];
    const params = [];
    if (line_type !== undefined) { updates.push("line_type = ?"); params.push(line_type); }
    if (ctrl_x !== undefined)    { updates.push("ctrl_x = ?");    params.push(ctrl_x);    }
    if (ctrl_y !== undefined)    { updates.push("ctrl_y = ?");    params.push(ctrl_y);    }
    if (updates.length === 0) return res.json({ success: true });
    params.push(connId, notebookId);
    await db.query(
      `UPDATE noteboard_connections SET ${updates.join(", ")} WHERE id = ? AND noteboard_id = ?`,
      params
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[connections update]", err);
    res.status(500).json({ error: "Failed to update connection" });
  }
});

// DELETE /api/noteboards/:id/connections/:connId
router.delete("/:id/connections/:connId", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const notebookId = parseInt(req.params.id, 10);
  const connId = parseInt(req.params.connId, 10);
  try {
    const [[board]] = await db.query(
      "SELECT id FROM noteboards WHERE id = ? AND user_name = ?",
      [notebookId, userName]
    );
    if (!board) return res.status(404).json({ error: "Noteboard not found" });

    await db.query(
      "DELETE FROM noteboard_connections WHERE id = ? AND noteboard_id = ?",
      [connId, notebookId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[connections delete]", err);
    res.status(500).json({ error: "Failed to delete connection" });
  }
});

// ── Clips (framed-selection copy from another user's public board) ─────────────

// POST /api/noteboards/:id/clips  –  paste a selection into board :id (as a pending clip)
// body: { source_board_id, items: [{ item_type, resource_id, text_content, title, w, h,
//          reading_progress, clip_dx, clip_dy, src_id }], connections: [{ from_src_id, to_src_id, line_type, label }] }
router.post("/:id/clips", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const targetId = parseInt(req.params.id, 10);
  const { source_board_id, items, connections } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items array required" });
  }
  try {
    // Target board must belong to the current user
    const [[target]] = await db.query(
      "SELECT id FROM noteboards WHERE id = ? AND user_name = ?",
      [targetId, userName]
    );
    if (!target) return res.status(404).json({ error: "Target noteboard not found" });

    // Source board must exist and be public; record its real owner as the author
    const [[src]] = await db.query(
      "SELECT user_name, is_public FROM noteboards WHERE id = ?",
      [source_board_id]
    );
    if (!src || !src.is_public) {
      return res.status(403).json({ error: "Source board is not public" });
    }

    const [clipRes] = await db.query(
      "INSERT INTO noteboard_clips (noteboard_id, source_board_id, source_user) VALUES (?, ?, ?)",
      [targetId, source_board_id, src.user_name]
    );
    const clipId = clipRes.insertId;

    const idMap = {}; // src_id → new item id
    for (const it of items) {
      const [r] = await db.query(
        `INSERT INTO noteboard_items
           (noteboard_id, item_type, resource_id, text_content, title, status,
            w, h, reading_progress, clip_id, locked, clip_dx, clip_dy)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 1, ?, ?)`,
        [targetId, it.item_type, it.resource_id ?? null, it.text_content ?? null,
         it.title ?? null, it.w ?? 5, it.h ?? 3,
         it.reading_progress ? JSON.stringify(it.reading_progress) : null,
         clipId, it.clip_dx ?? 0, it.clip_dy ?? 0]
      );
      if (it.src_id != null) idMap[it.src_id] = r.insertId;
    }

    if (Array.isArray(connections)) {
      for (const c of connections) {
        const from = idMap[c.from_src_id];
        const to = idMap[c.to_src_id];
        if (!from || !to) continue;
        await db.query(
          `INSERT INTO noteboard_connections (noteboard_id, from_item_id, to_item_id, line_type, label)
           VALUES (?, ?, ?, ?, ?)`,
          [targetId, from, to, c.line_type || "straight", c.label ?? null]
        );
      }
    }

    res.status(201).json({ clip_id: clipId, source_user: src.user_name, source_board_id });
  } catch (err) {
    console.error("[clips create]", err);
    res.status(500).json({ error: "Failed to copy selection" });
  }
});

// PATCH /api/noteboards/:id/clips/:clipId/deploy  –  place/move a whole clip at a base position
// body: { group_index, col, row }  (top-left of the clip; items keep their relative offsets)
router.patch("/:id/clips/:clipId/deploy", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const notebookId = parseInt(req.params.id, 10);
  const clipId = parseInt(req.params.clipId, 10);
  const { group_index, col, row } = req.body;
  try {
    const [[board]] = await db.query(
      "SELECT id FROM noteboards WHERE id = ? AND user_name = ?",
      [notebookId, userName]
    );
    if (!board) return res.status(404).json({ error: "Noteboard not found" });

    await db.query(
      `UPDATE noteboard_items
       SET status = 'deployed',
           group_index = ?,
           col = ? + clip_dx,
           row_index = ? + clip_dy
       WHERE clip_id = ? AND noteboard_id = ?`,
      [group_index ?? 0, col ?? 0, row ?? 0, clipId, notebookId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[clips deploy]", err);
    res.status(500).json({ error: "Failed to deploy clip" });
  }
});

// DELETE /api/noteboards/:id/clips/:clipId  –  remove a whole clip (items + their connections)
router.delete("/:id/clips/:clipId", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const notebookId = parseInt(req.params.id, 10);
  const clipId = parseInt(req.params.clipId, 10);
  try {
    const [[board]] = await db.query(
      "SELECT id FROM noteboards WHERE id = ? AND user_name = ?",
      [notebookId, userName]
    );
    if (!board) return res.status(404).json({ error: "Noteboard not found" });

    // Deleting items cascades to their connections via the connection FKs
    await db.query(
      "DELETE FROM noteboard_items WHERE clip_id = ? AND noteboard_id = ?",
      [clipId, notebookId]
    );
    await db.query(
      "DELETE FROM noteboard_clips WHERE id = ? AND noteboard_id = ?",
      [clipId, notebookId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[clips delete]", err);
    res.status(500).json({ error: "Failed to delete clip" });
  }
});

module.exports = router;
