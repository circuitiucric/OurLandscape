const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const jwtSecret = process.env.JWT_SECRET;

// ── Schema bootstrap ─────────────────────────────────────────────────────────
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS follow_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        owner_user VARCHAR(255) NOT NULL,
        name VARCHAR(120) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_default TINYINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_owner (owner_user)
      ) CHARACTER SET utf8mb4
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS follows (
        id INT AUTO_INCREMENT PRIMARY KEY,
        follower VARCHAR(255) NOT NULL,
        target_user VARCHAR(255) NOT NULL,
        level TINYINT NOT NULL DEFAULT 2,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_follow (follower, target_user),
        INDEX idx_follower (follower),
        INDEX idx_target (target_user)
      ) CHARACTER SET utf8mb4
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS follow_group_members (
        group_id INT NOT NULL,
        target_user VARCHAR(255) NOT NULL,
        PRIMARY KEY (group_id, target_user),
        FOREIGN KEY (group_id) REFERENCES follow_groups(id) ON DELETE CASCADE
      ) CHARACTER SET utf8mb4
    `);

    console.log("[follows] Schema ready");
  } catch (err) {
    console.error("[follows] init failed:", err.message);
  }
})();

const getUser = (req) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return null;
  try { return jwt.verify(token, jwtSecret).userName; } catch { return null; }
};

// Ensure user has a default group; return its id
const ensureDefaultGroup = async (owner) => {
  const [[row]] = await db.query(
    "SELECT id FROM follow_groups WHERE owner_user = ? AND is_default = 1 LIMIT 1",
    [owner]
  );
  if (row) return row.id;
  const [r] = await db.query(
    "INSERT INTO follow_groups (owner_user, name, sort_order, is_default) VALUES (?, ?, 0, 1)",
    [owner, "默认分组"]
  );
  return r.insertId;
};

// ── Groups ───────────────────────────────────────────────────────────────────

// List my groups (with member count)
router.get("/groups", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });
  try {
    await ensureDefaultGroup(me);
    const [groups] = await db.query(
      `SELECT g.id, g.name, g.is_default, g.sort_order,
              COUNT(m.target_user) AS member_count
       FROM follow_groups g
       LEFT JOIN follow_group_members m ON m.group_id = g.id
       WHERE g.owner_user = ?
       GROUP BY g.id
       ORDER BY g.is_default DESC, g.sort_order ASC, g.id ASC`,
      [me]
    );
    res.json({ groups });
  } catch (err) {
    console.error("[follows/groups GET]", err);
    res.status(500).json({ error: "Failed to load groups" });
  }
});

router.post("/groups", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });
  const name = (req.body?.name || "").toString().trim();
  if (!name) return res.status(400).json({ error: "name required" });
  try {
    const [[mx]] = await db.query(
      "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM follow_groups WHERE owner_user = ?",
      [me]
    );
    const [r] = await db.query(
      "INSERT INTO follow_groups (owner_user, name, sort_order) VALUES (?, ?, ?)",
      [me, name.slice(0, 120), mx.next]
    );
    res.json({ id: r.insertId, name, sort_order: mx.next, is_default: 0, member_count: 0 });
  } catch (err) {
    console.error("[follows/groups POST]", err);
    res.status(500).json({ error: "Failed" });
  }
});

router.patch("/groups/:id", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  const name = req.body?.name?.toString().trim();
  try {
    const [[g]] = await db.query(
      "SELECT id, is_default FROM follow_groups WHERE id = ? AND owner_user = ?",
      [id, me]
    );
    if (!g) return res.status(404).json({ error: "Not found" });
    if (g.is_default) return res.status(400).json({ error: "Cannot rename default group" });
    if (name) {
      await db.query("UPDATE follow_groups SET name = ? WHERE id = ?", [name.slice(0, 120), id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[follows/groups PATCH]", err);
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/groups/:id", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.params.id);
  try {
    const [[g]] = await db.query(
      "SELECT id, is_default FROM follow_groups WHERE id = ? AND owner_user = ?",
      [id, me]
    );
    if (!g) return res.status(404).json({ error: "Not found" });
    if (g.is_default) return res.status(400).json({ error: "Cannot delete default group" });
    await db.query("DELETE FROM follow_groups WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("[follows/groups DELETE]", err);
    res.status(500).json({ error: "Failed" });
  }
});

// ── Follow status / list ─────────────────────────────────────────────────────

// Check whether I follow a specific user (used by avatar hover)
router.get("/check/:targetUser", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });
  const target = req.params.targetUser;
  try {
    const [[f]] = await db.query(
      "SELECT id, level FROM follows WHERE follower = ? AND target_user = ?",
      [me, target]
    );
    if (!f) return res.json({ following: false });
    const [members] = await db.query(
      `SELECT m.group_id FROM follow_group_members m
       JOIN follow_groups g ON g.id = m.group_id
       WHERE m.target_user = ? AND g.owner_user = ?`,
      [target, me]
    );
    res.json({
      following: true,
      level: f.level,
      group_ids: members.map((r) => r.group_id),
    });
  } catch (err) {
    console.error("[follows/check]", err);
    res.status(500).json({ error: "Failed" });
  }
});

// Full following list (with each target's groups)
router.get("/", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });
  try {
    const [rows] = await db.query(
      `SELECT f.target_user, f.level, f.created_at,
              u.avatar_path, u.id AS user_id
       FROM follows f
       LEFT JOIN users u ON u.userName = f.target_user
       WHERE f.follower = ?
       ORDER BY f.created_at DESC`,
      [me]
    );
    const targets = rows.map((r) => r.target_user);
    const groupMap = {};
    if (targets.length) {
      const ph = targets.map(() => "?").join(",");
      const [gm] = await db.query(
        `SELECT m.target_user, g.id AS group_id, g.name AS group_name
         FROM follow_group_members m
         JOIN follow_groups g ON g.id = m.group_id
         WHERE g.owner_user = ? AND m.target_user IN (${ph})`,
        [me, ...targets]
      );
      gm.forEach((g) => {
        (groupMap[g.target_user] = groupMap[g.target_user] || []).push({
          id: g.group_id, name: g.group_name,
        });
      });
    }
    res.json({
      follows: rows.map((r) => ({
        target_user: r.target_user,
        user_id: r.user_id,
        avatar_path: r.avatar_path,
        level: r.level,
        created_at: r.created_at,
        groups: groupMap[r.target_user] || [],
      })),
    });
  } catch (err) {
    console.error("[follows GET]", err);
    res.status(500).json({ error: "Failed" });
  }
});

// Follow (or update) — body: { target_user, level, group_ids: [] }
router.post("/", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });
  const { target_user, level = 2, group_ids } = req.body || {};
  if (!target_user || target_user === me) return res.status(400).json({ error: "Invalid target" });
  try {
    // Verify target exists
    const [[u]] = await db.query("SELECT userName FROM users WHERE userName = ?", [target_user]);
    if (!u) return res.status(404).json({ error: "Target user not found" });

    await db.query(
      `INSERT INTO follows (follower, target_user, level) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE level = VALUES(level)`,
      [me, target_user, Number(level) || 2]
    );

    // Determine which groups to place into
    let finalGroupIds = Array.isArray(group_ids) ? group_ids.map(Number).filter(Boolean) : [];
    if (finalGroupIds.length === 0) {
      finalGroupIds = [await ensureDefaultGroup(me)];
    } else {
      // Validate ownership
      const ph = finalGroupIds.map(() => "?").join(",");
      const [rows] = await db.query(
        `SELECT id FROM follow_groups WHERE owner_user = ? AND id IN (${ph})`,
        [me, ...finalGroupIds]
      );
      finalGroupIds = rows.map((r) => r.id);
      if (finalGroupIds.length === 0) finalGroupIds = [await ensureDefaultGroup(me)];
    }

    // Replace memberships
    await db.query(
      `DELETE m FROM follow_group_members m
       JOIN follow_groups g ON g.id = m.group_id
       WHERE g.owner_user = ? AND m.target_user = ?`,
      [me, target_user]
    );
    for (const gid of finalGroupIds) {
      await db.query(
        "INSERT IGNORE INTO follow_group_members (group_id, target_user) VALUES (?, ?)",
        [gid, target_user]
      );
    }

    res.json({ success: true, group_ids: finalGroupIds, level: Number(level) || 2 });
  } catch (err) {
    console.error("[follows POST]", err);
    res.status(500).json({ error: "Failed" });
  }
});

// Unfollow
router.delete("/:targetUser", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });
  const target = req.params.targetUser;
  try {
    await db.query(
      `DELETE m FROM follow_group_members m
       JOIN follow_groups g ON g.id = m.group_id
       WHERE g.owner_user = ? AND m.target_user = ?`,
      [me, target]
    );
    await db.query("DELETE FROM follows WHERE follower = ? AND target_user = ?", [me, target]);
    res.json({ success: true });
  } catch (err) {
    console.error("[follows DELETE]", err);
    res.status(500).json({ error: "Failed" });
  }
});

module.exports = router;
