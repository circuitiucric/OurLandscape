const express = require("express");
const router = express.Router();
const db = require("../db");

// 获取所有帖子
router.get("/", (req, res) => {
  console.log("Received GET request for /api/threads");
  db.query("SELECT * FROM threads", (err, results) => {
    if (err) {
      console.error("Error fetching threads:", err);
      res.status(500).json({ error: "Error fetching threads" });
    } else {
      res.json(results);
    }
  });
});

// 获取特定批注的所有帖子
router.get("/annotation/:id", (req, res) => {
  console.log(
    `Received GET request for /api/threads/annotation/${req.params.id}`
  );
  const { id } = req.params;
  db.query(
    "SELECT * FROM threads WHERE annotation_id = ?",
    [id],
    (err, results) => {
      if (err) {
        console.error("Error fetching threads for annotation:", err);
        res
          .status(500)
          .json({ error: "Error fetching threads for annotation" });
      } else {
        res.json(results);
      }
    }
  );
});

// 创建新帖子
router.post("/", (req, res) => {
  console.log("Received POST request for /api/threads with body:", req.body);
  const { annotation_id, content, userName } = req.body;
  const query =
    "INSERT INTO threads (annotation_id, content, userName) VALUES (?, ?, ?)";

  db.query(query, [annotation_id, content, userName], (err, result) => {
    if (err) {
      console.error("Error creating thread:", err);
      res.status(500).json({ error: "Failed to add thread" });
    } else {
      res.json({
        id: result.insertId,
        annotation_id,
        content,
        userName,
        created_at: new Date(),
      });
    }
  });
});

module.exports = router;
