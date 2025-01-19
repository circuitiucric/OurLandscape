const express = require("express");
const router = express.Router();
const db = require("../db"); // 已经是 mysql2/promise 创建的连接池
const jwt = require("jsonwebtoken");
const jwtSecret = process.env.JWT_SECRET;

// 获取批注（支持根据 replyId 过滤）
router.get("/", async (req, res) => {
  const { pdfFile, replyId } = req.query;
  console.log("Received GET /api/annotations with query:", {
    pdfFile,
    replyId, //这里的类型是字符形式，可能是这里导致批注区无法正常显示？
  });

  let query = "SELECT * FROM annotations WHERE 1=1";
  let params = [];

  if (pdfFile) {
    query += " AND pdf_file = ?";
    params.push(pdfFile);
  }

  if (replyId) {
    // 确保 replyId 是数字类型
    const numericReplyId = parseInt(replyId, 10);
    query += " AND reply_id = ?";
    params.push(numericReplyId);
  }

  console.log("Executing query:", query, "with params:", params);

  try {
    const [results] = await db.query(query, params);
    console.log("Query results:", results);
    res.json(results);
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
