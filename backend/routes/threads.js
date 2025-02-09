const express = require("express");
const router = express.Router();
const pool = require("../db"); // 假设你已经有一个用于数据库连接的文件

// 创建帖子（或获取现有帖子）
router.post("/create", async (req, res) => {
  const { annotationId, userName } = req.body;

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
      // 如果没有帖子，创建新帖子
      const [result] = await pool.query(
        "INSERT INTO threads (annotation_id, created_by) VALUES (?, ?)",
        [annotationId, userName]
      );
      threadId = result.insertId;

      // 获取批注信息
      const [annotation] = await pool.query(
        "SELECT * FROM annotations WHERE annotation_id = ?",
        [annotationId]
      );

      if (annotation.length === 0) {
        return res.status(404).json({ error: "Annotation not found" });
      }

      let linkText;
      if (annotation[0].pdf_file && annotation[0].page_number) {
        // 如果批注是来自 PDF 页面
        const jumpText = `#《${annotation[0].pdf_file}》 P${annotation[0].page_number}#`;
        linkText = `<a href="http://localhost:3002/pdf-viewer?file=${annotation[0].pdf_file}&page=${annotation[0].page_number}" target="_blank">${jumpText}</a>`;
      } else if (annotation[0].replyId) {
        // 如果批注是来自帖子区
        linkText = `<a href="http://localhost:3002/threads/${annotation[0].replyId}" target="_blank">帖子区批注</a>`;
      }

      // 只在帖子第一次创建时插入包含跳转链接的首个回复
      await pool.query(
        "INSERT INTO replies (thread_id, content, created_by) VALUES (?, ?, ?)",
        [
          threadId,
          `${linkText} - ${annotation[0].text}`,
          annotation[0].userName,
        ]
      );
    }

    // 返回帖子的 ID（无论是新创建的，还是已有的）
    res.status(201).json({ threadId });
  } catch (error) {
    console.error("Error creating thread:", error);
    res.status(500).json({ error: "Failed to create thread" });
  }
});

/// 获取特定线程的帖子
router.get("/:threadId", async (req, res) => {
  const { threadId } = req.params;

  try {
    const [thread] = await pool.query(
      "SELECT * FROM threads WHERE id = ?", // 根据 threadId 查找
      [threadId]
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
