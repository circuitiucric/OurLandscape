const express = require("express");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
require("dotenv").config();

const app = express();

const corsOptions = {
  origin: "http://localhost:3002", // 允许的前端 URL
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: ["Content-Type", "Authorization"], // 允许的请求头
};

app.use(cors(corsOptions)); // 使用 cors 中间件
app.use(express.json()); // 使用 express 内置的 JSON 解析中间件
app.use(express.urlencoded({ extended: false })); // 使用 express 内置的 URL 编码解析中间件

app.use(express.static(path.join(__dirname, "public")));

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET is not defined");
}

const conn = mysql.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: "xxhhqq007",
  database: "pdf_website",
  multipleStatements: true,
});

// 用户注册
app.post("/register", (req, res) => {
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
      console.log("Login query result:", result); // 打印查询结果
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

// 用户登录
app.post("/login", (req, res) => {
  const { userName, passWord } = req.body;
  if (!userName || !passWord) {
    return res.send({
      code: 0,
      msg: "用户名与密码为必传参数...",
    });
  }
  const sqlStr = "SELECT * FROM users WHERE userName=? AND passWord=?";
  conn.query(sqlStr, [userName, passWord], (err, result) => {
    if (err) throw err;
    if (result.length > 0) {
      // 确保 payload 包含 userName
      const payload = { userName: result[0].userName };
      const token = jwt.sign(payload, jwtSecret, {
        expiresIn: "1h",
        algorithm: "HS256",
      });
      console.log("Generated token with payload:", payload, "Token:", token); // 打印调试信息
      res.send({ code: 1, msg: "登录成功", token: token });
    } else {
      res.send({ code: 0, msg: "登录失败" });
    }
  });
});

// 获取 PDF 文件列表
app.get("/pdfs", (req, res) => {
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

// 获取单个 PDF 文件
app.get("/pdf/:filename", (req, res) => {
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

// 挂载批注模块路由
const annotationsRouter = require("./annotations");
app.use("/api/annotations", annotationsRouter);

module.exports = app;
