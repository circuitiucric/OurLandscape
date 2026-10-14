const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const jwtSecret = process.env.JWT_SECRET;

// ── Schema bootstrap ─────────────────────────────────────────────────────────
// 直接发帖：threads.annotation_id 可空 + title + post_type
// 三类事件本身各自带 visibility_level（动作发起者在创建时设置）：
//   0 = 不出现在他人动态中
//   1 = 仅在动态中显示关联资源（隐藏正文/批注内容）
//   2 = 完整展示
(async () => {
  const tryAlter = async (sql) => { try { await db.query(sql); } catch {} };
  await tryAlter("ALTER TABLE threads MODIFY annotation_id INT NULL");
  await tryAlter("ALTER TABLE threads ADD COLUMN title VARCHAR(500) DEFAULT NULL");
  await tryAlter("ALTER TABLE threads ADD COLUMN post_type VARCHAR(20) DEFAULT 'annotation'");
  await tryAlter("ALTER TABLE threads ADD COLUMN visibility_level TINYINT NOT NULL DEFAULT 2");
  await tryAlter("ALTER TABLE replies ADD COLUMN visibility_level TINYINT NOT NULL DEFAULT 2");
  await tryAlter("ALTER TABLE annotations ADD COLUMN visibility_level TINYINT NOT NULL DEFAULT 2");
  console.log("[feed] Schema ready");
})();

const getUser = (req) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return null;
  try { return jwt.verify(token, jwtSecret).userName; } catch { return null; }
};

// Visibility level: 0 hidden, 1 resource-only, 2 full
//
// GET /api/feed
//   ?group_id=<id>     - filter to one group (omit for all followed users)
//   ?limit=30 &offset=0
//
// Returns mixed activity events in reverse-chronological order:
//   { kind: "annotation" | "reply" | "post", actor, at, payload, level }

router.get("/", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  const groupId = req.query.group_id ? Number(req.query.group_id) : null;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const offset = Number(req.query.offset) || 0;

  try {
    // Resolve target users for this view
    let targets;
    if (groupId) {
      const [[g]] = await db.query(
        "SELECT id FROM follow_groups WHERE id = ? AND owner_user = ?",
        [groupId, me]
      );
      if (!g) return res.status(404).json({ error: "Group not found" });
      const [rows] = await db.query(
        `SELECT f.target_user
         FROM follows f
         JOIN follow_group_members m ON m.target_user = f.target_user
         WHERE f.follower = ? AND m.group_id = ?`,
        [me, groupId]
      );
      targets = rows.map((r) => r.target_user);
    } else {
      const [rows] = await db.query(
        "SELECT target_user FROM follows WHERE follower = ?",
        [me]
      );
      targets = rows.map((r) => r.target_user);
      // "全部"视图下始终包含自己
      if (!targets.includes(me)) targets.push(me);
    }

    if (targets.length === 0) {
      return res.json({ events: [], users: {} });
    }

    const ph = targets.map(() => "?").join(",");

    // Fetch user metadata for renderer
    const [userMeta] = await db.query(
      `SELECT userName, id, avatar_path FROM users WHERE userName IN (${ph})`,
      targets
    );
    const users = {};
    userMeta.forEach((u) => {
      users[u.userName] = { id: u.id, avatar_path: u.avatar_path };
    });

    // Larger fetch window so we can sort across kinds
    const window = limit * 3 + offset;

    // 1) Annotations — visibility_level > 0
    // annotations 表没有 thread_id 列,通过两条路径推导:
    //   PDF 批注 → t.annotation_id = a.annotation_id (该批注创建的帖子)
    //   楼层批注 → rp.id = a.reply_id → rp.thread_id (该楼层所在帖子)
    const [annotations] = await db.query(
      `SELECT a.annotation_id AS id, a.user_name AS actor, a.text, a.selected_text,
              a.pdf_file, a.page_number, a.reply_id, a.created_at,
              a.visibility_level,
              COALESCE(t.id, rp.thread_id) AS thread_id,
              r.id AS resource_id, r.title AS resource_title, r.type AS resource_type,
              r.cover_path
       FROM annotations a
       LEFT JOIN resources r ON r.identifier = a.pdf_file AND r.type = 'pdf'
       LEFT JOIN threads t ON t.annotation_id = a.annotation_id
       LEFT JOIN replies rp ON rp.id = a.reply_id
       WHERE a.user_name IN (${ph}) AND a.visibility_level > 0
       ORDER BY a.created_at DESC
       LIMIT ?`,
      [...targets, window]
    );

    // 2) Replies — visibility_level > 0; exclude direct-post root replies (rendered as posts)
    const [replies] = await db.query(
      `SELECT rp.id, rp.thread_id, rp.created_by AS actor, rp.content, rp.created_at,
              rp.source_selection, rp.visibility_level,
              t.title AS thread_title, t.post_type
       FROM replies rp
       JOIN threads t ON t.id = rp.thread_id
       WHERE rp.created_by IN (${ph}) AND rp.visibility_level > 0
       ORDER BY rp.created_at DESC
       LIMIT ?`,
      [...targets, window]
    );

    // 3) Direct posts (no upstream annotation) — visibility_level > 0
    const [posts] = await db.query(
      `SELECT t.id, t.created_by AS actor, t.title, t.created_at, t.visibility_level,
              (SELECT rp.content FROM replies rp
                 WHERE rp.thread_id = t.id ORDER BY rp.id ASC LIMIT 1) AS body
       FROM threads t
       WHERE t.created_by IN (${ph})
         AND t.post_type = 'direct'
         AND t.visibility_level > 0
       ORDER BY t.created_at DESC
       LIMIT ?`,
      [...targets, window]
    );

    const events = [];

    annotations.forEach((a) => {
      const lvl = a.visibility_level;
      events.push({
        kind: "annotation",
        id: `a${a.id}`,
        actor: a.actor,
        at: a.created_at,
        level: lvl,
        payload: {
          annotation_id: a.id,
          thread_id: a.thread_id,
          text: lvl >= 2 ? a.text : null,
          selected_text: lvl >= 2 ? a.selected_text : null,
          resource: a.resource_id ? {
            id: a.resource_id,
            title: a.resource_title,
            type: a.resource_type,
            cover_path: a.cover_path,
            identifier: a.pdf_file,
            page: a.page_number,
          } : (a.pdf_file ? {
            id: null, title: a.pdf_file, type: "pdf",
            cover_path: null, identifier: a.pdf_file, page: a.page_number,
          } : null),
        },
      });
    });

    replies.forEach((rp) => {
      // Skip the auto-generated root reply of a direct post (we render the post itself instead)
      if (rp.post_type === "direct") return;
      const lvl = rp.visibility_level;
      let bodyText = "";
      try {
        const parsed = typeof rp.content === "string" ? JSON.parse(rp.content) : rp.content;
        bodyText = (parsed?.blocks || []).map((b) => b?.content || "").join(" ").slice(0, 240);
      } catch { bodyText = String(rp.content || "").slice(0, 240); }
      events.push({
        kind: "reply",
        id: `r${rp.id}`,
        actor: rp.actor,
        at: rp.created_at,
        level: lvl,
        payload: {
          reply_id: rp.id,
          thread_id: rp.thread_id,
          thread_title: rp.thread_title,
          body: lvl >= 2 ? bodyText : null,
        },
      });
    });

    posts.forEach((p) => {
      const lvl = p.visibility_level;
      let bodyText = "";
      try {
        const parsed = typeof p.body === "string" ? JSON.parse(p.body) : p.body;
        bodyText = (parsed?.blocks || []).map((b) => b?.content || "").join(" ").slice(0, 400);
      } catch { bodyText = String(p.body || "").slice(0, 400); }
      events.push({
        kind: "post",
        id: `p${p.id}`,
        actor: p.actor,
        at: p.created_at,
        level: lvl,
        payload: {
          thread_id: p.id,
          title: p.title,
          body: lvl >= 2 ? bodyText : null,
        },
      });
    });

    events.sort((a, b) => new Date(b.at) - new Date(a.at));
    const slice = events.slice(offset, offset + limit);

    res.json({ events: slice, users, total_loaded: events.length });
  } catch (err) {
    console.error("[feed GET]", err);
    res.status(500).json({ error: "Failed to load feed" });
  }
});

// POST /api/feed/post  – create a direct (no-parent) post
// Body: { title, body, visibility_level }
router.post("/post", async (req, res) => {
  const me = getUser(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });
  const title = (req.body?.title || "").toString().trim().slice(0, 500);
  const body = (req.body?.body || "").toString();
  if (!title) return res.status(400).json({ error: "title required" });
  if (!body.trim()) return res.status(400).json({ error: "body required" });
  const v = req.body?.visibility_level;
  const vLevel = (v === 0 || v === 1 || v === 2) ? v : 2;

  try {
    // 动态发布的「文章/想法」即一级帖子：annotation_id = NULL 且 root_thread_id = NULL
    // （一级帖子的判定标准为 root_thread_id IS NULL，与批注派生的根帖一致）。
    const [t] = await db.query(
      `INSERT INTO threads (annotation_id, created_by, root_thread_id, title, post_type, visibility_level)
       VALUES (NULL, ?, NULL, ?, 'direct', ?)`,
      [me, title || null, vLevel]
    );
    const threadId = t.insertId;

    const contentJson = { blocks: [{ type: "text", content: body }] };
    await db.query(
      `INSERT INTO replies (thread_id, content, created_by, root_thread_id, visibility_level)
       VALUES (?, ?, ?, ?, ?)`,
      [threadId, JSON.stringify(contentJson), me, threadId, vLevel]
    );

    res.json({ success: true, thread_id: threadId });
  } catch (err) {
    console.error("[feed/post]", err);
    res.status(500).json({ error: "Failed" });
  }
});

module.exports = router;
