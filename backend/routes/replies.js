const express = require("express");
const router = express.Router();
const db = require("../db");

// 获取所有回复
router.get("/", (req, res) => {
  db.query("SELECT * FROM replies", (err, results) => {
    if (err) {
      console.error("Error fetching replies:", err);
      res.status(500).json({ error: "Error fetching replies" });
    } else {
      res.json(results);
    }
  });
});

// 获取特定帖子的所有回复
router.get("/thread/:id", (req, res) => {
  const { id } = req.params;
  db.query(
    "SELECT * FROM replies WHERE thread_id = ?",
    [id],
    (err, results) => {
      if (err) {
        console.error("Error fetching replies for thread:", err);
        res.status(500).json({ error: "Error fetching replies for thread" });
      } else {
        res.json(results);
      }
    }
  );
});

// 创建新回复
router.post("/", (req, res) => {
  const { thread_id, content, userName } = req.body;
  const query =
    "INSERT INTO replies (thread_id, content, userName) VALUES (?, ?, ?)";

  db.query(query, [thread_id, content, userName], (err, result) => {
    if (err) {
      console.error("Error creating reply:", err);
      res.status(500).json({ error: "Error creating reply" });
    } else {
      res.json({
        id: result.insertId,
        thread_id,
        content,
        userName,
        created_at: new Date(),
      });
    }
  });
});

module.exports = router;
