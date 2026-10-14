const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const jwtSecret = process.env.JWT_SECRET;

// 视频批注所需字段（在已有安装上补列）
(async () => {
  const tryAlter = async (sql) => { try { await db.query(sql); } catch {} };
  await tryAlter("ALTER TABLE annotations ADD COLUMN video_file VARCHAR(500) DEFAULT NULL");
  await tryAlter("ALTER TABLE annotations ADD COLUMN video_time FLOAT DEFAULT NULL");
})();

// 字段名转换工具函数
const mapAnnotationFields = (item) => ({
  id: item.annotation_id,
  pdfFile: item.pdf_file,
  pageNumber: item.page_number,
  videoFile: item.video_file,
  videoTime: item.video_time,
  text: item.text,
  userName: item.user_name,
  yPosition: item.position_y,
  y2Position: item.y2_position,
  x1Position: item.x1_position,
  x2Position: item.x2_position,
  createdAt: item.created_at,
  replyId: item.reply_id,
  selectedText: item.selected_text,
  textStartOffset: item.text_start_offset,
  textEndOffset: item.text_end_offset,
});

// 获取批注列表（支持 pdfFile/replyId/threadId 筛选）
router.get("/", async (req, res) => {
  const { pdfFile, videoFile, replyId, threadId } = req.query;

  // 批量获取某帖子全部批注（JOIN replies）
  if (threadId) {
    try {
      const [results] = await db.query(
        `SELECT a.annotation_id, a.pdf_file, a.page_number, a.text, a.user_name,
                a.position_y, a.y2_position, a.x1_position, a.x2_position,
                a.created_at, a.reply_id, a.selected_text, a.text_start_offset, a.text_end_offset
         FROM annotations a
         JOIN replies r ON a.reply_id = r.id
         WHERE r.thread_id = ?
         ORDER BY a.created_at ASC`,
        [parseInt(threadId, 10)]
      );
      return res.json(results.map(mapAnnotationFields));
    } catch (err) {
      console.error("Error fetching annotations by threadId:", err);
      return res.status(500).json({ error: "Error fetching annotations" });
    }
  }

  let query = `
SELECT
  annotation_id,
  pdf_file,
  page_number,
  video_file,
  video_time,
  text,
  user_name,
  position_y,
  y2_position,
  x1_position,
  x2_position,
  created_at,
  reply_id,
  selected_text,
  text_start_offset,
  text_end_offset
FROM annotations WHERE 1=1
  `;
  const params = [];

  if (pdfFile) {
    query += " AND pdf_file = ?";
    params.push(pdfFile);
  }

  if (videoFile) {
    query += " AND video_file = ?";
    params.push(videoFile);
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
  video_file,
  video_time,
  text,
  user_name,
  position_y,
  y2_position,
  x1_position,
  x2_position,
  created_at,
  reply_id,
  selected_text,
  text_start_offset,
  text_end_offset
FROM annotations WHERE annotation_id = ?
`,
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
    const {
      pdfFile,
      pageNumber,
      videoFile,
      videoTime,
      text,
      replyId,
      yPosition,
      y2Position,
      x1Position,
      x2Position,
      selectedText,
      textStartOffset,
      textEndOffset,
      visibilityLevel,
    } = req.body;

    // 构建插入参数
    let fields = ["text", "user_name", "position_y", "selected_text", "text_start_offset", "text_end_offset"];
    let values = [text, decoded.userName, yPosition, selectedText, textStartOffset, textEndOffset];
    const vLevel = (visibilityLevel === 0 || visibilityLevel === 1 || visibilityLevel === 2)
      ? visibilityLevel : 2;
    fields.push("visibility_level");
    values.push(vLevel);

    if (pdfFile) {
      fields.push("pdf_file", "page_number");
      values.push(pdfFile, pageNumber);
    } else if (videoFile) {
      fields.push("video_file", "video_time");
      values.push(videoFile, typeof videoTime === "number" ? videoTime : 0);
    } else if (replyId) {
      fields.push("reply_id");
      values.push(replyId);
    }

    if (typeof y2Position === "number") {
      fields.push("y2_position");
      values.push(y2Position);
    }
    if (typeof x1Position === "number") {
      fields.push("x1_position");
      values.push(x1Position);
    }
    if (typeof x2Position === "number") {
      fields.push("x2_position");
      values.push(x2Position);
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
      videoFile,
      videoTime,
      text,
      userName: decoded.userName,
      yPosition,
      y2Position,
      x1Position,
      x2Position,
      replyId,
      selectedText,
      textStartOffset,
      textEndOffset,
      createdAt: new Date(),
    };
    res.status(201).json(newAnnotation);
  } catch (err) {
    console.error("Error creating annotation:", err);
    res.status(500).json({ error: err.code || "Database error" });
  }
});

module.exports = router;
