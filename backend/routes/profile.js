const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const jwtSecret = process.env.JWT_SECRET;

// Auto-migrate: profile-specific columns on users table
(async () => {
  const tryAlter = async (sql) => { try { await db.query(sql); } catch {} };
  await tryAlter("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT NULL");
  await tryAlter("ALTER TABLE users ADD COLUMN region VARCHAR(120) DEFAULT NULL");
  await tryAlter("ALTER TABLE users ADD COLUMN preferences VARCHAR(500) DEFAULT NULL");
  await tryAlter("ALTER TABLE users ADD COLUMN avatar_path VARCHAR(500) DEFAULT NULL");
  console.log("[profile] Schema ready");
})();

const getUser = (req) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return null;
  try { return jwt.verify(token, jwtSecret).userName; } catch { return null; }
};

// Shared loader for a profile by userName. `isSelf` controls private fields.
async function loadProfile(userName, isSelf) {
  const [[user]] = await db.query(
    "SELECT id, userName, email, created_at, bio, region, preferences, avatar_path FROM users WHERE userName = ?",
    [userName]
  );
  if (!user) return null;

    // Stats
    const [[recCount]] = await db.query(
      "SELECT COUNT(*) AS c FROM recommendations WHERE user_name = ?",
      [userName]
    );
    let followingCount = 0, followerCount = 0;
    try {
      const [[fg]] = await db.query("SELECT COUNT(*) AS c FROM follows WHERE follower = ?", [userName]);
      followingCount = Number(fg?.c) || 0;
      const [[fr]] = await db.query("SELECT COUNT(*) AS c FROM follows WHERE target_user = ?", [userName]);
      followerCount = Number(fr?.c) || 0;
    } catch {}

    // Noteboards owned by user, with item-type summary for the Box display
    const [boards] = await db.query(
      `SELECT id, title, description, updated_at, created_at
       FROM noteboards WHERE user_name = ? ORDER BY updated_at DESC`,
      [userName]
    );

    let boardItems = [];
    if (boards.length > 0) {
      const ph = boards.map(() => "?").join(",");
      const [rows] = await db.query(
        `SELECT ni.noteboard_id, ni.item_type, ni.title AS item_title,
                r.type AS resource_type, r.cover_path, r.identifier
         FROM noteboard_items ni
         LEFT JOIN resources r ON ni.resource_id = r.id
         WHERE ni.noteboard_id IN (${ph}) AND ni.status = 'deployed'
         ORDER BY ni.updated_at DESC`,
        boards.map((b) => b.id)
      );
      boardItems = rows;
    }
    const itemMap = {};
    boardItems.forEach((it) => {
      (itemMap[it.noteboard_id] = itemMap[it.noteboard_id] || []).push(it);
    });
    const noteboards = boards.map((b) => ({
      ...b,
      items: (itemMap[b.id] || []).slice(0, 5),
      item_count: (itemMap[b.id] || []).length,
    }));

    // Recent history (last 12)
    const [history] = await db.query(
      `SELECT r.id, r.type, r.identifier, r.title, r.cover_path,
              rh.updated_at,
              COUNT(DISTINCT rh2.user_name) AS viewer_count
       FROM reading_history rh
       JOIN resources r ON rh.resource_id = r.id
       LEFT JOIN reading_history rh2 ON r.id = rh2.resource_id
       WHERE rh.user_name = ?
       GROUP BY r.id, rh.updated_at
       ORDER BY rh.updated_at DESC
       LIMIT 12`,
      [userName]
    );

    // Enrich history with comment counts (annotations on PDFs + recommendation evaluations)
    const resIds = history.map((h) => h.id);
    const annotationCounts = {};
    const evalCounts = {};
    const tagsMap = {};
    const connMap = {};
    if (resIds.length > 0) {
      const ph = resIds.map(() => "?").join(",");

      const [annRows] = await db.query(
        `SELECT r.id AS resource_id, COUNT(a.annotation_id) AS cnt
         FROM resources r
         JOIN annotations a ON a.pdf_file = r.identifier
         WHERE r.id IN (${ph}) AND r.type = 'pdf'
         GROUP BY r.id`,
        resIds
      );
      annRows.forEach((r) => { annotationCounts[r.resource_id] = Number(r.cnt); });

      const [evalRows] = await db.query(
        `SELECT resource_id, COUNT(*) AS cnt
         FROM recommendations
         WHERE resource_id IN (${ph}) AND evaluation IS NOT NULL
         GROUP BY resource_id`,
        resIds
      );
      evalRows.forEach((r) => { evalCounts[r.resource_id] = Number(r.cnt); });

      const [tagRows] = await db.query(
        `SELECT resource_id, tag, vote_score FROM resource_tags
         WHERE resource_id IN (${ph}) ORDER BY vote_score DESC`,
        resIds
      );
      tagRows.forEach((t) => {
        (tagsMap[t.resource_id] = tagsMap[t.resource_id] || []).push({ tag: t.tag, vote_score: t.vote_score });
      });

      const [connRows] = await db.query(
        `SELECT ni.resource_id, nb.id AS board_id, nb.title AS board_title, nb.user_name
         FROM noteboard_items ni
         JOIN noteboards nb ON ni.noteboard_id = nb.id
         WHERE ni.resource_id IN (${ph}) AND ni.status = 'deployed'`,
        resIds
      );
      connRows.forEach((c) => {
        (connMap[c.resource_id] = connMap[c.resource_id] || []).push({
          board_id: c.board_id, board_title: c.board_title, user_name: c.user_name,
        });
      });
    }

    const historyCards = history.map((h) => ({
      id: h.id,
      type: h.type,
      identifier: h.identifier,
      title: h.title,
      cover_path: h.cover_path,
      viewer_count: Number(h.viewer_count) || 0,
      comment_count: (annotationCounts[h.id] || 0) + (evalCounts[h.id] || 0),
      tags: tagsMap[h.id] || [],
      notebook_connections: connMap[h.id] || [],
      recommendations: [],
      updated_at: h.updated_at,
    }));

  return {
    user: {
      id: user.id,
      userName: user.userName,
      email: isSelf ? user.email : null,
      created_at: user.created_at,
      bio: user.bio,
      region: user.region,
      preferences: user.preferences,
      avatar_path: user.avatar_path,
    },
    stats: {
      recommendations: Number(recCount.c),
      following: followingCount,
      followers: followerCount,
      likes: 0,
    },
    noteboards,
    history: historyCards,
    is_self: isSelf,
  };
}

// GET /api/profile/me  –  aggregate page data for the logged-in user
router.get("/me", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  try {
    const data = await loadProfile(userName, true);
    if (!data) return res.status(404).json({ error: "User not found" });
    res.json(data);
  } catch (err) {
    console.error("[profile/me]", err);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

// GET /api/profile/:userName  –  view another user's profile (login required)
router.get("/:userName", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });
  const target = req.params.userName;
  try {
    const data = await loadProfile(target, me === target);
    if (!data) return res.status(404).json({ error: "User not found" });
    res.json(data);
  } catch (err) {
    console.error("[profile/:userName]", err);
    res.status(500).json({ error: "Failed to load profile" });
  }
});

// PATCH /api/profile/me  –  edit bio/region/preferences
router.patch("/me", async (req, res) => {
  const userName = getUser(req);
  if (!userName) return res.status(401).json({ error: "Unauthorized" });
  const { bio, region, preferences } = req.body;
  try {
    await db.query(
      `UPDATE users SET
         bio = COALESCE(?, bio),
         region = COALESCE(?, region),
         preferences = COALESCE(?, preferences)
       WHERE userName = ?`,
      [bio ?? null, region ?? null, preferences ?? null, userName]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[profile patch]", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

module.exports = router;
