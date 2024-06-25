const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const indexRouter = require("./routes/index");

// 使用 bodyParser 中间件
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// 解决跨域问题
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Content-Type", "application/json;charset=utf-8");
  next();
});

// 使用路由
app.use("/", indexRouter);

module.exports = app;
