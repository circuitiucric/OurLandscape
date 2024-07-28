const express = require("express");
const router = express.Router();
const db = require("../db");

// 获取指定annotationId的帖子内容
router.get("/", async (req, res) => {
  const { annotationId } = req.query;
  if (!annotationId) {
    return res.status(400).json({ error: "annotationId is required" });
  }

  try {
    const [rows] = await db.query(
      "SELECT * FROM threads WHERE annotation_id = ?",
      [annotationId]
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ error: "No thread found for the provided annotationId" });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching thread by annotationId:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 获取指定ID帖子的所有回复
router.get("/:id/replies", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM replies WHERE thread_id = ?", [
      req.params.id,
    ]);
    res.send(rows);
  } catch (error) {
    console.error("Error fetching replies:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

// 创建新帖子
router.post("/", async (req, res) => {
  try {
    const { annotationId, content, userName } = req.body;
    const [result] = await db.query(
      "INSERT INTO threads (annotation_id, content, userName) VALUES (?, ?, ?)",
      [annotationId, content, userName]
    );
    res.send({ id: result.insertId, annotationId, content, userName });
  } catch (error) {
    console.error("Error creating thread:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

module.exports = router;
