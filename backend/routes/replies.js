const express = require("express");
const router = express.Router();
const db = require("../db");

// 创建新回复
router.post("/", async (req, res) => {
  try {
    const { thread_id, content, userName } = req.body;
    const [result] = await db.query(
      "INSERT INTO replies (thread_id, content, userName) VALUES (?, ?, ?)",
      [thread_id, content, userName]
    );
    res.send({ id: result.insertId, thread_id, content, userName });
  } catch (error) {
    console.error("Error creating reply:", error);
    res.status(500).send({ error: "Internal Server Error" });
  }
});

module.exports = router;
