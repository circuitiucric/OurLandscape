const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const mysql = require("mysql2");
const path = require("path");
const fs = require("fs");

const conn = mysql.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: "xxhhqq007",
  database: "react-pro",
  multipleStatements: true,
});

// 注册端口
router.post("/register", (req, res) => {
  var userName = req.body.userName;
  var passWord = req.body.passWord;
  if (!userName || !passWord) {
    res.send({
      code: 0,
      msg: "用户名与密码为必传参数...",
    });
    return;
  }
  if (userName && passWord) {
    const result = `SELECT * FROM users WHERE userName = ?`;
    conn.query(result, [userName], (err, results) => {
      if (err) throw err;
      if (results.length >= 1) {
        res.send({ code: 0, msg: "注册失败，用户名重复" });
      } else {
        const sqlStr = "INSERT INTO users(userName,passWord) VALUES(?,?)";
        conn.query(sqlStr, [userName, passWord], (err, results) => {
          if (err) throw err;
          if (results.affectedRows === 1) {
            res.send({ code: 1, msg: "注册成功" });
          } else {
            res.send({ code: 0, msg: "注册失败" });
          }
        });
      }
    });
  }
  console.log("接收", req.body);
});

// 登录端口
router.post("/login", (req, res) => {
  var userName = req.body.userName;
  var passWord = req.body.passWord;
  if (!userName || !passWord) {
    res.send({
      code: 0,
      msg: "用户名与密码为必传参数...",
    });
    return;
  }
  const sqlStr = "SELECT * FROM users WHERE userName=? AND passWord=?";
  conn.query(sqlStr, [userName, passWord], (err, result) => {
    if (err) throw err;
    if (result.length > 0) {
      // 生成token
      var token = jwt.sign(
        {
          identity: result[0].identity,
          userName: result[0].userName,
        },
        "secret",
        { expiresIn: "1h" }
      );
      console.log(token);
      res.send({ code: 1, msg: "登录成功", token: token });
    } else {
      res.send({ code: 0, msg: "登录失败" });
    }
  });
});

// 提供PDF文件列表的端口
router.get("/pdfs", (req, res) => {
  const pdfDir = path.join(__dirname, "../public/pdf");
  fs.readdir(pdfDir, (err, files) => {
    if (err) {
      console.error("Error reading PDF directory:", err);
      res.status(500).send("Error reading PDF directory");
      return;
    }

    const pdfFiles = files.filter((file) => file.endsWith(".pdf"));
    res.json(pdfFiles);
  });
});

// 提供单个 PDF 文件的端口
router.get("/pdf/:filename", (req, res) => {
  const pdfDir = path.join(__dirname, "../public/pdf");
  const filePath = path.join(pdfDir, req.params.filename);

  res.setHeader("Content-Type", "application/pdf");
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("Error sending PDF file:", err);
      res.status(404).send("PDF file not found");
    }
  });
});

module.exports = router;
