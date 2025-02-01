const express = require("express");
const router = express.Router();
const db = require("../db"); // 已经是 mysql2/promise 创建的连接池
const jwt = require("jsonwebtoken");
const jwtSecret = process.env.JWT_SECRET;

router.get("/", async (req, res) => {
  const { pdfFile, replyId } = req.query;
  console.log("Received GET /api/annotations with query:", {
    pdfFile,
    replyId,
  });

  let query = "SELECT * FROM annotations WHERE 1=1";
  let params = [];

  if (pdfFile) {
    query += " AND pdf_file = ?";
    params.push(pdfFile);
  }

  if (replyId) {
    const numericReplyId = parseInt(replyId, 10);
    query += " AND reply_id = ?";
    params.push(numericReplyId);
  }

  console.log("Executing query:", query, "with params:", params);

  try {
    const [results] = await db.query(query, params);

    // 映射字段名，将 `reply_id` 改为 `replyId`
    const mappedResults = results.map((item) => ({
      ...item,
      id: item.annotation_id, // 将 annotation_id 映射为 id
      replyId: item.reply_id, // 将 reply_id 映射为 replyId
      annotation_id: undefined, // 清理旧字段名
      reply_id: undefined, // 清理旧字段名
    }));

    console.log("Query results:", mappedResults);
    res.json(mappedResults);
  } catch (err) {
    console.error("Error fetching annotations:", err);
    res.status(500).json({ error: "Error fetching annotations" });
  }
});

// 获取单个批注根据批注ID
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const numericId = parseInt(id, 10);
  console.log("Received request for annotation ID:", id);

  const query = "SELECT * FROM annotations WHERE annotation_id = ?";
  console.log("Executing query:", query, "with id:", numericId);

  try {
    const [result] = await db.query(query, [numericId]);
    if (result.length === 0) {
      res.status(404).json({ error: "Annotation not found" });
    } else {
      console.log("Fetched annotation:", result[0]);
      res.json(result[0]);
    }
  } catch (err) {
    console.error("Error executing query:", err);
    res.status(500).json({ error: "Error executing query" });
  }
});

// 添加批注
router.post("/", async (req, res) => {
  console.log("Received POST request with body:", req.body);
  const { pdfFile, pageNumber, text, replyId } = req.body; //这里的replyId形式是任意，这是否可以解释批注输入框能正常工作而批注显示区却不行？
  const token = req.headers.authorization.split(" ")[1];
  let userName;

  try {
    // 解码JWT token，获取用户名
    const decoded = jwt.verify(token, jwtSecret);
    userName = decoded.userName;

    console.log("Decoded userName:", userName); // 打印解码的用户名
  } catch (err) {
    console.error("Token verification failed:", err);
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 如果是 PDF 批注，插入 pdf_file 和 page_number 字段
  let query;
  let values;

  if (pdfFile) {
    query =
      "INSERT INTO annotations (pdf_file, page_number, text, userName) VALUES (?, ?, ?, ?)";
    values = [pdfFile, pageNumber, text, userName];
  }
  // 如果是回帖批注，插入 reply_id 字段
  else if (replyId) {
    query =
      "INSERT INTO annotations (reply_id, text, userName) VALUES (?, ?, ?)";
    values = [replyId, text, userName];
  }

  console.log("Inserting annotation with values:", values);

  try {
    // 使用 Promise 执行数据库查询
    const [result] = await db.query(query, values);

    // 构造新批注对象并返回给客户端
    const newAnnotation = {
      id: result.insertId,
      pdfFile,
      pageNumber,
      text,
      userName,
      created_at: new Date(),
      replyId,
    };
    console.log("Added annotation:", newAnnotation);
    res.json(newAnnotation);
  } catch (err) {
    console.error("Error adding annotation:", err);
    res.status(500).json({ error: "Error adding annotation" });
  }
});

module.exports = router;
