const express = require("express");
const router = express.Router();
const pool = require("../db"); // 假设你已经有一个用于数据库连接的文件

// 创建一个新的帖子
router.post("/create", async (req, res) => {
  const { annotationId, userName } = req.body;

  try {
    const [existingThread] = await pool.query(
      "SELECT * FROM threads WHERE annotation_id = ?",
      [annotationId]
    );

    if (existingThread.length > 0) {
      return res.status(200).json({ threadId: existingThread[0].id });
    }

    const [result] = await pool.query(
      "INSERT INTO threads (annotation_id, created_by) VALUES (?, ?)",
      [annotationId, userName]
    );

    res.status(201).json({ threadId: result.insertId });
  } catch (error) {
    console.error("Error creating thread:", error);
    res.status(500).json({ error: "Failed to create thread" });
  }
});

// 获取特定批注的帖子
router.get("/:annotationId", async (req, res) => {
  const { annotationId } = req.params;

  try {
    const [thread] = await pool.query(
      "SELECT * FROM threads WHERE annotation_id = ?",
      [annotationId]
    );

    if (thread.length === 0) {
      return res.status(404).json({ error: "Thread not found" });
    }

    res.status(200).json(thread[0]);
  } catch (error) {
    console.error("Error fetching thread:", error);
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

module.exports = router;
