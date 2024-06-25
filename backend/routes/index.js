const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const mysql = require("mysql2");

//连接MySQL数据库需要输入密码
const conn = mysql.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: "xxhhqq007",
  database: "react-pro",
  multipleStatements: true,
});

// 注册端口，检查用户名和密码是否为空
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
    //执行SQL查询
    const result = `SELECT * FROM users WHERE userName = ?`;
    conn.query(result, [userName], (err, results) => {
      if (err) throw err; //检查查询过程中是否发生错误，如果没有误
      if (results.length >= 1) {
      //如果用户名存在于数据库中
        res.send({ code: 0, msg: "注册失败，用户名重复" });
      }
      else {
      //如果用户名不存在于数据库中
        const sqlStr = "INSERT INTO users(userName,passWord) VALUES(?,?)";
        conn.query(sqlStr, [userName, passWord], (err, results) => {
          if (err) throw err;
          if (results.affectedRows === 1) {
            res.send({ code: 1, msg: "注册成功" });
          } else {
            //如果查询过程中有误
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
      // 生成token（是啥子自行搜索吧）
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

module.exports = router;
