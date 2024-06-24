const express = require("express");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const mysql = require("mysql");

const router = express.Router();

const conn = mysql.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: "root",
  database: "react-pro",
  multipleStatements: true,
});

router.use(bodyParser.urlencoded({ extended: false }));
router.use(bodyParser.json());

// 解决跨域
router.all("*", function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Content-Type", "application/json;charset=utf-8");
  next();
});

// 用户注册
router.post("/register", (req, res) => {
  const { userName, passWord } = req.body;
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
        // 如果有相同用户名，则注册失败，用户名重复
        res.send({ code: 0, msg: "注册失败，用户名重复" });
      } else {
        const sqlStr = "INSERT INTO users(userName, passWord) VALUES(?, ?)";
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
router.post("/login", (req, res) => {
  const { username, password } = req.body;
  const sql = "SELECT * FROM users WHERE username = ? AND password = ?";
  conn.query(sql, [username, password], (err, results) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (results.length > 0) {
      const token = jwt.sign({ id: results[0].id }, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });
      res.status(200).json({ message: "Login successful!", token });
    } else {
      res.status(401).json({ message: "Invalid credentials" });
    }
  });
});

module.exports = router;
