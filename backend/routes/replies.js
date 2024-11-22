const express = require("express");
const router = express.Router();
const db = require("../db");

// POST /api/replies - 创建新回复
router.post("/", async (req, res) => {
  const { thread_id, content, created_by } = req.body;

  if (!thread_id || !content || !created_by) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const [result] = await db.query(
      "INSERT INTO replies (thread_id, content, created_by) VALUES (?, ?, ?)",
      [thread_id, content, created_by]
    );
    res.status(201).json({ success: true, replyId: result.insertId });
  } catch (error) {
    console.error("Error inserting reply:", error);
    res.status(500).json({ error: "Failed to create reply" });
  }
});

// GET /api/replies - 获取特定帖子（thread）相关的所有回复
router.get("/", async (req, res) => {
  const { threadId } = req.query; // 使用 threadId

  if (!threadId) {
    return res.status(400).json({ error: "Missing threadId" });
  }

  try {
    // 查找与 threadId 相关的所有回复
    const [replies] = await db.query(
      "SELECT * FROM replies WHERE thread_id = ? ORDER BY created_at ASC",
      [threadId]
    );

    res.json(replies); // 返回相关的所有回复
  } catch (error) {
    console.error("Error fetching replies:", error);
    res.status(500).json({ error: "Failed to fetch replies" });
  }
});

module.exports = router;
