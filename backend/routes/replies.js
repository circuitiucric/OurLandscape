const express = require("express");
const router = express.Router();
const db = require("../db");
const multer = require("multer");
const path = require("path");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const jwtSecret = process.env.JWT_SECRET;

// 鉴权中间件：要求合法 token，将 userName 注入 req.user
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = { userName: decoded.userName };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "../public/uploads/"));
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 限制5MB
  },
  fileFilter: function (req, file, cb) {
    // 只允许图片
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("仅支持图片文件"));
    }
  },
});

// POST /api/replies/upload - 上传图片
router.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "没有上传文件" });
  }

  // 返回图片URL
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

// POST /api/replies - 创建新回复（需登录，作者强制取自 token）
router.post("/", requireAuth, async (req, res) => {
  const { thread_id, content, source_selection, visibility_level } = req.body;
  const created_by = req.user.userName;

  if (!thread_id || !content) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  let contentJson;
  if (typeof content === "string") {
    contentJson = { blocks: [{ type: "text", content: content }] };
  } else {
    contentJson = content;
  }

  const sourceSelectionStr = source_selection
    ? (typeof source_selection === "string" ? source_selection : JSON.stringify(source_selection))
    : null;

  try {
    // 确定 root_thread_id：根帖子（root_thread_id IS NULL）用自身 id，子帖子继承
    const [threadRows] = await db.query(
      "SELECT id, root_thread_id FROM threads WHERE id = ?",
      [thread_id]
    );
    const parentThread = threadRows[0];
    const rootThreadId = parentThread
      ? (parentThread.root_thread_id !== null ? parentThread.root_thread_id : parentThread.id)
      : null;

    const vLevel = (visibility_level === 0 || visibility_level === 1 || visibility_level === 2)
      ? visibility_level : 2;

    const [result] = await db.query(
      "INSERT INTO replies (thread_id, content, created_by, source_selection, root_thread_id, visibility_level) VALUES (?, ?, ?, ?, ?, ?)",
      [thread_id, JSON.stringify(contentJson), created_by, sourceSelectionStr, rootThreadId, vLevel]
    );
    res.status(201).json({ success: true, replyId: result.insertId });
  } catch (error) {
    console.error("Error inserting reply:", error);
    res.status(500).json({ error: "Failed to create reply" });
  }
});

// GET /api/replies - 获取特定帖子（thread）相关的所有回复
router.get("/", async (req, res) => {
  const { threadId } = req.query; // 使用 threadId

  if (!threadId) {
    return res.status(400).json({ error: "Missing threadId" });
  }

  try {
    // 查找与 threadId 相关的所有回复
    const [replies] = await db.query(
      "SELECT * FROM replies WHERE thread_id = ? ORDER BY created_at ASC",
      [threadId]
    );

    // 处理每个回复的 content,确保它是解析后的 JSON
    const processedReplies = replies.map((reply) => {
      try {
        if (typeof reply.content === "string") {
          reply.content = JSON.parse(reply.content);
        }
      } catch (e) {
        // 如果解析失败,将其转换为块格式
        reply.content = {
          blocks: [
            {
              type: "text",
              content: reply.content,
            },
          ],
        };
      }
      return reply;
    });

    res.json(processedReplies); // 返回处理后的回复
  } catch (error) {
    console.error("Error fetching replies:", error);
    res.status(500).json({ error: "Failed to fetch replies" });
  }
});

module.exports = router;
