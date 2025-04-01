const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const jwtSecret = process.env.JWT_SECRET;

// 字段名转换工具函数
const mapAnnotationFields = (item) => ({
  id: item.annotation_id,
  pdfFile: item.pdf_file,
  pageNumber: item.page_number,
  text: item.text,
  userName: item.user_name,
  yPosition: item.position_y,
  createdAt: item.created_at,
  replyId: item.reply_id,
});

// 获取批注列表（支持 pdfFile/replyId 筛选）
router.get("/", async (req, res) => {
  const { pdfFile, replyId } = req.query;
  let query = `
    SELECT 
      annotation_id, 
      pdf_file, 
      page_number, 
      text, 
      user_name, 
      position_y, 
      created_at, 
      reply_id
    FROM annotations WHERE 1=1
  `;
  const params = [];

  if (pdfFile) {
    query += " AND pdf_file = ?";
    params.push(pdfFile);
  }

  if (replyId) {
    query += " AND reply_id = ?";
    params.push(parseInt(replyId, 10));
  }

  try {
    const [results] = await db.query(query, params);
    res.json(results.map(mapAnnotationFields));
  } catch (err) {
    console.error("Error fetching annotations:", err);
    res.status(500).json({ error: "Error fetching annotations" });
  }
});

// 获取单个批注
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const [result] = await db.query(
      `SELECT 
        annotation_id, 
        pdf_file, 
        page_number, 
        text, 
        user_name, 
        position_y, 
        created_at, 
        reply_id
       FROM annotations WHERE annotation_id = ?`,
      [id]
    );
    result.length > 0
      ? res.json(mapAnnotationFields(result[0]))
      : res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error("Error fetching annotation:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 创建批注
router.post("/", async (req, res) => {
  try {
    console.log("Received annotation data:", req.body); // 打印接收的数据
    // 用户认证
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const decoded = jwt.verify(token, jwtSecret);
    const { pdfFile, pageNumber, text, replyId, yPosition } = req.body;

    // 构建插入参数
    let fields = ["text", "user_name", "position_y"];
    let values = [text, decoded.userName, yPosition];

    if (pdfFile) {
      fields.push("pdf_file", "page_number");
      values.push(pdfFile, pageNumber);
    } else if (replyId) {
      fields.push("reply_id");
      values.push(replyId);
    }

    // 执行插入
    const [result] = await db.query(
      `INSERT INTO annotations (${fields.join()}) VALUES (${fields
        .map(() => "?")
        .join()})`,
      values
    );

    // 返回新建的批注
    const newAnnotation = {
      id: result.insertId,
      pdfFile,
      pageNumber,
      text,
      userName: decoded.userName,
      yPosition,
      replyId,
      createdAt: new Date(),
    };
    res.status(201).json(newAnnotation);
  } catch (err) {
    console.error("Error creating annotation:", err);
    res.status(500).json({ error: err.code || "Database error" });
  }
});

module.exports = router;
