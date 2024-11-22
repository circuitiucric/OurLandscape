const express = require("express");
const router = express.Router();
const db = require("../db");
const jwt = require("jsonwebtoken");
const jwtSecret = process.env.JWT_SECRET;

// 获取所有批注
router.get("/", (req, res) => {
  const { pdfFile } = req.query;
  const query = pdfFile
    ? "SELECT * FROM annotations WHERE pdf_file = ?"
    : "SELECT * FROM annotations";
  const params = pdfFile ? [pdfFile] : [];

  console.log("Fetching annotations with query:", query, "and params:", params);

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching annotations:", err);
      res.status(500).json({ error: "Error fetching annotations" });
    } else {
      console.log("Fetched annotations:", results);
      res.json(results);
    }
  });
});

// 获取单个批注根据批注ID
router.get("/:id", (req, res) => {
  const { id } = req.params;
  const numericId = parseInt(id, 10);
  console.log("Received request for annotation ID:", id);

  const query = "SELECT * FROM annotations WHERE annotation_id = ?";
  console.log("Executing query:", query, "with id:", numericId);

  db.query(query, [numericId])
    .then((result) => {
      if (result.length === 0) {
        res.status(404).json({ error: "Annotation not found" });
      } else {
        console.log("Fetched annotation:", result[0]);
        res.json(result[0]);
      }
    })
    .catch((err) => {
      console.error("Error executing query:", err);
      res.status(500).json({ error: "Error executing query" });
    });
});

// 添加批注
router.post("/", (req, res) => {
  const { pdfFile, pageNumber, text } = req.body;
  const token = req.headers.authorization.split(" ")[1];
  let userName;

  try {
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

  db.query(query, [pdfFile, pageNumber, text, userName], (err, result) => {
    if (err) {
      console.error("Error adding annotation:", err);
      res.status(500).json({ error: "Error adding annotation" });
    } else {
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
    }
  });
});

module.exports = router;
