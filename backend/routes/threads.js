const express = require("express");
const router = express.Router();
const pool = require("../db"); // 假设你已经有一个用于数据库连接的文件
const jwt = require("jsonwebtoken");
require("dotenv").config();
const jwtSecret = process.env.JWT_SECRET;

// 从 Authorization 头解析 userName（无 token / 非法 token → null）
function getUserName(req) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret).userName;
  } catch {
    return null;
  }
}

// ── Schema：楼主排序 ──────────────────────────────────────────────────────────
// owner_featured_floors 记录「一级帖主」勾选的优先楼层及顺序。
// reply_id 可指向本帖或其任意子帖下的楼层（含子帖「主楼」对应的首条回复）——
// 因整棵帖子树中所有 replies.root_thread_id 都等于该一级帖 id，故以此过滤校验归属。
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS owner_featured_floors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        root_thread_id INT NOT NULL,
        reply_id INT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_root_reply (root_thread_id, reply_id),
        KEY idx_root (root_thread_id)
      )
    `);
    console.log("[threads] owner_featured_floors ready");
  } catch (e) {
    console.error("[threads] ensure owner_featured_floors failed", e);
  }
})();

// 从 reply.content（JSON 块结构）中提取纯文本。
// 注意：批注偏移量（text_start_offset/text_end_offset）是在渲染后的
// .reply-text-content 文本内容上计算的，各块之间无分隔符，故此处用 "" 连接以对齐偏移量。
function extractReplyText(content) {
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    if (parsed && Array.isArray(parsed.blocks)) {
      return parsed.blocks
        .filter((b) => b.type === "text")
        .map((b) => b.content || "")
        .join("");
    }
  } catch {}
  return typeof content === "string" ? content : "";
}

// 创建帖子（或获取现有帖子）
router.post("/create", async (req, res) => {
  // 帖主取自批注作者（见下方 INSERT），不再信任前端传来的 userName——
  // 旧前端常传字面量 "Current User"，会导致 created_by 与登录用户不符、
  // 楼主排序（owner-sort）因 isOwner 永不成立而无法显示。
  const { annotationId } = req.body;

  try {
    // 检查该批注是否已存在帖子
    const [existingThread] = await pool.query(
      "SELECT * FROM threads WHERE annotation_id = ?",
      [annotationId]
    );

    let threadId;
    if (existingThread.length > 0) {
      // 如果帖子已存在，直接返回现有的帖子 ID
      threadId = existingThread[0].id;
    } else {
      // 获取批注信息（需要在创建帖子前获取，以确定 root_thread_id）
      const [annotation] = await pool.query(
        "SELECT * FROM annotations WHERE annotation_id = ?",
        [annotationId]
      );

      if (annotation.length === 0) {
        return res.status(404).json({ error: "Annotation not found" });
      }

      // 确定 root_thread_id：
      // - 批注来自 PDF（reply_id 为空）→ 新帖子本身就是根，root_thread_id = NULL
      // - 批注来自某楼层（reply_id 非空）→ 继承该楼层的 root_thread_id
      let rootThreadId = null;
      if (annotation[0].reply_id) {
        const [parentReply] = await pool.query(
          "SELECT root_thread_id, thread_id FROM replies WHERE id = ?",
          [annotation[0].reply_id]
        );
        if (parentReply.length > 0) {
          rootThreadId = parentReply[0].root_thread_id;
        }
      }

      const [result] = await pool.query(
        "INSERT INTO threads (annotation_id, created_by, root_thread_id) VALUES (?, ?, ?)",
        [annotationId, annotation[0].user_name, rootThreadId]
      );
      threadId = result.insertId;

      // 注意：批注派生的帖子不再自动生成「置顶回复」（曾经的二楼）。
      // 批注信息与回原文/回历史链接已由帖子页主楼区域（thread.text + 选中文字
      // 上下文 + 回到原文/查看历史对话）直接展示。第一条真实楼层应来自用户回复。
      // 仅「直接发布」的想法帖（见 feed.js /post）才把正文作为二楼。
    }

    // 返回帖子的 ID（无论是新创建的，还是已有的）
    res.status(201).json({ threadId });
  } catch (error) {
    console.error("Error creating thread:", error);
    res.status(500).json({ error: "Failed to create thread" });
  }
});

// 获取帖子的「历史对话」链：从当前帖子的来源批注溯源到第一级
// 每一项表示：某帖子的主楼批注 → 它当初所回复（锚定）的楼层
router.get("/:threadId/history", async (req, res) => {
  const startId = parseInt(req.params.threadId, 10);
  if (Number.isNaN(startId)) {
    return res.status(400).json({ error: "Invalid threadId" });
  }

  try {
    const chain = [];
    const visited = new Set();
    let currentThreadId = startId;
    // 溯源终点（第一级帖子）的 id：用于在链尾附加该帖子的「主楼」本身
    let rootThreadId = null;

    // 防止环路或异常数据导致死循环
    while (currentThreadId != null && !visited.has(currentThreadId) && chain.length < 50) {
      visited.add(currentThreadId);

      const [threadRows] = await pool.query(
        "SELECT id, annotation_id FROM threads WHERE id = ?",
        [currentThreadId]
      );
      if (threadRows.length === 0) break;
      // 无来源批注 → 该帖为第一级（如「想法」直发帖），已到溯源终点
      if (!threadRows[0].annotation_id) { rootThreadId = currentThreadId; break; }

      const [annoRows] = await pool.query(
        "SELECT annotation_id, text, selected_text, reply_id FROM annotations WHERE annotation_id = ?",
        [threadRows[0].annotation_id]
      );
      if (annoRows.length === 0) break;
      const anno = annoRows[0];
      // 批注无 reply_id → 来自 PDF/视频，该帖即第一级，无更上层楼层
      if (!anno.reply_id) { rootThreadId = currentThreadId; break; }

      const [replyRows] = await pool.query(
        "SELECT id, thread_id, content, created_by, created_at FROM replies WHERE id = ?",
        [anno.reply_id]
      );
      if (replyRows.length === 0) break;
      const reply = replyRows[0];

      // 计算该楼层在其所属帖子内的序号
      const [floors] = await pool.query(
        "SELECT id FROM replies WHERE thread_id = ? ORDER BY created_at ASC",
        [reply.thread_id]
      );
      const floorNumber = floors.findIndex((f) => f.id === reply.id) + 1;

      chain.push({
        threadId: currentThreadId,
        annotationText: anno.text,
        selectedText: anno.selected_text,
        floor: {
          replyId: reply.id,
          threadId: reply.thread_id,
          floorNumber,
          createdBy: reply.created_by,
          text: extractReplyText(reply.content),
        },
      });

      // 继续从该楼层所属的（上一级）帖子溯源
      currentThreadId = reply.thread_id;
    }

    // 附加第一级帖子的「主楼」本身（区别于该帖下被回复的某个楼层）
    if (rootThreadId != null) {
      const [rootRows] = await pool.query(
        `SELECT t.id, t.created_by, t.title, t.post_type,
                a.text AS anno_text, a.user_name AS anno_user, a.selected_text
         FROM threads t
         LEFT JOIN annotations a ON t.annotation_id = a.annotation_id
         WHERE t.id = ?`,
        [rootThreadId]
      );
      if (rootRows.length > 0) {
        const r = rootRows[0];
        chain.push({
          threadId: r.id,
          isRootMainPost: true,
          annotationText: r.anno_text || r.title || "",
          selectedText: r.selected_text || null,
          mainPost: {
            threadId: r.id,
            createdBy: r.anno_user || r.created_by,
            postType: r.post_type,
          },
        });
      }
    }

    res.json(chain);
  } catch (error) {
    console.error("Error building thread history:", error);
    res.status(500).json({ error: "Failed to build history" });
  }
});

/// 获取特定线程的帖子（含批注原文数据）
router.get("/:threadId", async (req, res) => {
  const { threadId } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.annotation_id, t.created_by AS thread_created_by, t.created_at, t.root_thread_id,
              t.title, t.post_type,
              a.text, a.user_name, a.pdf_file, a.page_number, a.video_file, a.video_time, a.selected_text,
              a.position_y, a.x1_position, a.x2_position, a.y2_position,
              a.reply_id, a.text_start_offset, a.text_end_offset
       FROM threads t
       LEFT JOIN annotations a ON t.annotation_id = a.annotation_id
       WHERE t.id = ?`,
      [threadId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const row = rows[0];

    // 选中文字的上下文：从来源楼层正文中各取选区前后 20 个字符（仅限帖子区批注）
    let selectionContextBefore = null;
    let selectionContextAfter = null;
    if (
      row.reply_id != null &&
      row.text_start_offset != null &&
      row.text_end_offset != null
    ) {
      const [replyRows] = await pool.query(
        "SELECT content FROM replies WHERE id = ?",
        [row.reply_id]
      );
      if (replyRows.length > 0) {
        const fullText = extractReplyText(replyRows[0].content);
        const start = row.text_start_offset;
        const end = row.text_end_offset;
        selectionContextBefore = fullText.slice(Math.max(0, start - 20), start);
        selectionContextAfter = fullText.slice(end, end + 20);
      }
    }

    res.status(200).json({
      id: row.id,
      annotationId: row.annotation_id,
      createdBy: row.thread_created_by,
      createdAt: row.created_at,
      rootThreadId: row.root_thread_id,
      title: row.title,
      postType: row.post_type,
      // 直接发布的「想法」没有批注源，主楼正文用标题，作者用发帖人
      text: row.text,
      userName: row.user_name || row.thread_created_by,
      pdfFile: row.pdf_file,
      pageNumber: row.page_number,
      videoFile: row.video_file,
      videoTime: row.video_time,
      selectedText: row.selected_text,
      selectionContextBefore,
      selectionContextAfter,
    });
  } catch (error) {
    console.error("Error fetching thread:", error);
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

// ── 楼主排序：辅助函数 ─────────────────────────────────────────────────────────

// 解析 reply.content（容错为块结构）
function parseContent(content) {
  try {
    const p = typeof content === "string" ? JSON.parse(content) : content;
    if (p && Array.isArray(p.blocks)) return p;
  } catch {}
  return { blocks: [{ type: "text", content: typeof content === "string" ? content : "" }] };
}

// 子帖展示名：标题 > 批注选中文字 > 批注正文（截断）
function threadLabel(row) {
  const cand = row.thread_title || row.selected_text || row.anno_text || "";
  return (cand || "").toString().slice(0, 40);
}

// 取整棵帖子树（以 rootId 为根的一级帖 + 其所有子帖）的全部楼层，按所属帖子分组计算楼层序号。
async function fetchTreeFloors(rootId) {
  const [rows] = await pool.query(
    `SELECT rp.id AS reply_id, rp.thread_id, rp.root_thread_id, rp.content,
            rp.created_by, rp.created_at, rp.source_selection,
            t.title AS thread_title, t.annotation_id, t.post_type,
            a.text AS anno_text, a.selected_text
     FROM replies rp
     JOIN threads t ON t.id = rp.thread_id
     LEFT JOIN annotations a ON a.annotation_id = t.annotation_id
     WHERE rp.root_thread_id = ?
     ORDER BY rp.thread_id ASC, rp.created_at ASC, rp.id ASC`,
    [rootId]
  );
  const counters = new Map();
  return rows.map((r) => {
    const n = (counters.get(r.thread_id) || 0) + 1;
    counters.set(r.thread_id, n);
    const isSub = r.thread_id !== Number(rootId);
    return {
      replyId: r.reply_id,
      threadId: r.thread_id,
      rootThreadId: r.root_thread_id,
      content: parseContent(r.content),
      createdBy: r.created_by,
      createdAt: r.created_at,
      sourceSelection: r.source_selection || null,
      floorNumber: n,
      isSubThread: isSub,
      threadLabel: isSub ? threadLabel(r) : null,
    };
  });
}

// GET /api/threads/:rootId/owner-sort
// 公开：返回该一级帖「楼主排序」勾选的优先楼层（按楼主设定的顺序，已富集楼层内容）。
router.get("/:rootId/owner-sort", async (req, res) => {
  const rootId = parseInt(req.params.rootId, 10);
  if (Number.isNaN(rootId)) return res.status(400).json({ error: "Invalid rootId" });
  try {
    const [[t]] = await pool.query(
      "SELECT id, created_by, root_thread_id FROM threads WHERE id = ?",
      [rootId]
    );
    if (!t) return res.status(404).json({ error: "Thread not found" });

    const [feat] = await pool.query(
      "SELECT reply_id, sort_order FROM owner_featured_floors WHERE root_thread_id = ? ORDER BY sort_order ASC, id ASC",
      [rootId]
    );
    if (feat.length === 0) {
      return res.json({ owner: t.created_by, isFirstLevel: t.root_thread_id == null, floors: [] });
    }

    const all = await fetchTreeFloors(rootId);
    const byId = new Map(all.map((f) => [f.replyId, f]));
    const floors = feat
      .map((f) => {
        const e = byId.get(f.reply_id);
        return e ? { ...e, sortOrder: f.sort_order } : null;
      })
      .filter(Boolean);

    res.json({ owner: t.created_by, isFirstLevel: t.root_thread_id == null, floors });
  } catch (e) {
    console.error("[owner-sort GET]", e);
    res.status(500).json({ error: "Failed to load owner sort" });
  }
});

// GET /api/threads/:rootId/tree-floors
// 仅帖主：列出整棵帖子树的全部楼层（含各子帖），供「编辑楼主排序」时勾选。
router.get("/:rootId/tree-floors", async (req, res) => {
  const rootId = parseInt(req.params.rootId, 10);
  if (Number.isNaN(rootId)) return res.status(400).json({ error: "Invalid rootId" });
  const me = getUserName(req);
  try {
    const [[t]] = await pool.query(
      "SELECT id, created_by, root_thread_id FROM threads WHERE id = ?",
      [rootId]
    );
    if (!t) return res.status(404).json({ error: "Thread not found" });
    if (t.root_thread_id != null) {
      return res.status(400).json({ error: "Only first-level threads support owner-sort" });
    }
    if (!me || me !== t.created_by) {
      return res.status(403).json({ error: "Only the owner can edit owner-sort" });
    }

    const all = await fetchTreeFloors(rootId);
    const [feat] = await pool.query(
      "SELECT reply_id FROM owner_featured_floors WHERE root_thread_id = ?",
      [rootId]
    );
    const featSet = new Set(feat.map((f) => f.reply_id));
    res.json(all.map((f) => ({ ...f, featured: featSet.has(f.replyId) })));
  } catch (e) {
    console.error("[tree-floors GET]", e);
    res.status(500).json({ error: "Failed to load tree floors" });
  }
});

// POST /api/threads/:rootId/owner-sort   body: { replyIds: number[] }
// 仅一级帖主：用给定的有序 replyIds 整体覆盖该帖的「楼主排序」勾选。
router.post("/:rootId/owner-sort", async (req, res) => {
  const rootId = parseInt(req.params.rootId, 10);
  if (Number.isNaN(rootId)) return res.status(400).json({ error: "Invalid rootId" });
  const me = getUserName(req);
  if (!me) return res.status(401).json({ error: "Unauthorized" });

  const replyIds = Array.isArray(req.body?.replyIds)
    ? req.body.replyIds.map(Number).filter((n) => !Number.isNaN(n))
    : null;
  if (!replyIds) return res.status(400).json({ error: "replyIds array required" });

  try {
    const [[t]] = await pool.query(
      "SELECT id, created_by, root_thread_id FROM threads WHERE id = ?",
      [rootId]
    );
    if (!t) return res.status(404).json({ error: "Thread not found" });
    if (t.root_thread_id != null) {
      return res.status(400).json({ error: "Only first-level threads support owner-sort" });
    }
    if (me !== t.created_by) {
      return res.status(403).json({ error: "Only the owner can set owner-sort" });
    }

    // 去重（保留首次出现的顺序），并校验每个楼层都属于本帖子树
    const unique = [...new Set(replyIds)];
    let valid = [];
    if (unique.length > 0) {
      const ph = unique.map(() => "?").join(",");
      const [rows] = await pool.query(
        `SELECT id FROM replies WHERE id IN (${ph}) AND root_thread_id = ?`,
        [...unique, rootId]
      );
      const okSet = new Set(rows.map((r) => r.id));
      valid = unique.filter((id) => okSet.has(id));
    }

    await pool.query("DELETE FROM owner_featured_floors WHERE root_thread_id = ?", [rootId]);
    for (let i = 0; i < valid.length; i++) {
      await pool.query(
        "INSERT INTO owner_featured_floors (root_thread_id, reply_id, sort_order) VALUES (?, ?, ?)",
        [rootId, valid[i], i]
      );
    }
    res.json({ success: true, count: valid.length });
  } catch (e) {
    console.error("[owner-sort POST]", e);
    res.status(500).json({ error: "Failed to save owner sort" });
  }
});

module.exports = router;
