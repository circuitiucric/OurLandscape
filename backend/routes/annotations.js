// annotations.js
const express = require("express");
const router = express.Router();
const db = require("../db"); // 已经是 mysql2/promise 创建的连接池
const jwt = require("jsonwebtoken");
const jwtSecret = process.env.JWT_SECRET;

// 获取所有批注
router.get("/", async (req, res) => {
  const { pdfFile } = req.query;
  console.log("Received GET /api/annotations with query:", pdfFile);

  const query = pdfFile
    ? "SELECT * FROM annotations WHERE pdf_file = ?"
    : "SELECT * FROM annotations"; // 如果没有 pdfFile 参数，查询所有批注
  const params = pdfFile ? [pdfFile] : [];

  console.log("Executing query:", query, "with params:", params);

  try {
    // 使用 Promise 执行数据库查询
    const [results] = await db.query(query, params);
    console.log("Query results:", results); // 输出查询结果
    if (results.length === 0) {
      console.log("No annotations found");
    }
    res.json(results); // 返回查询结果
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
    // 使用 Promise 执行数据库查询
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
  const { pdfFile, pageNumber, text } = req.body;
  const token = req.headers.authorization.split(" ")[1];
  let userName;

  try {
    // 解码JWT token，获取用户名
    const decoded = jwt.verify(token, jwtSecret);
    userName = decoded.userName;
  } catch (err) {
    console.error("Token verification failed:", err);
    return res.status(401).json({ error: "Unauthorized" });
  }

  const query =
    "INSERT INTO annotations (pdf_file, page_number, text, userName) VALUES (?, ?, ?, ?)";

  console.log("Inserting annotation with values:", [
    pdfFile,
    pageNumber,
    text,
    userName,
  ]);

  try {
    // 使用Promise方式执行数据库查询
    const [result] = await db.query(query, [
      pdfFile,
      pageNumber,
      text,
      userName,
    ]);

    // 构造新批注对象并返回给客户端
    const newAnnotation = {
      id: result.insertId,
      pdfFile,
      pageNumber,
      text,
      userName,
      created_at: new Date(),
    };
    console.log("Added annotation:", newAnnotation);
    res.json(newAnnotation);
  } catch (err) {
    console.error("Error adding annotation:", err);
    res.status(500).json({ error: "Error adding annotation" });
  }
});

module.exports = router;
