const express = require("express");
const router = express.Router();
const db = require("../db");

// 获取所有批注
router.get("/", (req, res) => {
  const { pdfFile } = req.query;
  const query = pdfFile
    ? "SELECT * FROM annotations WHERE pdf_file = ?"
    : "SELECT * FROM annotations";
  const params = pdfFile ? [pdfFile] : [];

  db.query(query, params, (err, results) => {
    if (err) {
      console.error("Error fetching annotations:", err);
      res.status(500).json({ error: "Error fetching annotations" });
    } else {
      res.json(results);
    }
  });
});

// 添加批注
router.post("/", (req, res) => {
  const { pdfFile, pageNumber, text } = req.body;
  const query =
    "INSERT INTO annotations (pdf_file, page_number, text) VALUES (?, ?, ?)";

  db.query(query, [pdfFile, pageNumber, text], (err, result) => {
    if (err) {
      console.error("Error adding annotation:", err);
      res.status(500).json({ error: "Error adding annotation" });
    } else {
      res.json({
        id: result.insertId,
        pdfFile,
        pageNumber,
        text,
        created_at: new Date(),
      });
    }
  });
});

module.exports = router;
