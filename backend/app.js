const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const app = express();
const indexRouter = require("./routes/index");
const annotationsRouter = require("./routes/annotations");
const repliesRouter = require("./routes/replies");
const threadsRouter = require("./routes/threads"); // 添加这一行

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Content-Type", "application/json;charset=utf-8");
  next();
});

// 添加日志输出，确认请求是否到达服务器
app.use((req, res, next) => {
  console.log(`Received ${req.method} request for ${req.url}`);
  next();
});

// 设置静态文件服务
app.use("/pdf", express.static(path.join(__dirname, "public", "pdf")));
console.log(
  "Serving static files from:",
  path.join(__dirname, "public", "pdf")
);

// 路由处理
app.use("/", indexRouter);
app.use("/api/annotations", annotationsRouter);
app.use("/api/replies", repliesRouter);
app.use("/api/threads", threadsRouter); // 添加这一行

// 添加日志输出，以确认请求路径和文件名
app.get("/pdf/:filename", (req, res) => {
  const filePath = path.join(__dirname, "public", "pdf", req.params.filename);
  console.log("Requested file:", filePath);
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("Error sending file:", err);
      res.status(err.status).end();
    } else {
      console.log("File sent successfully:", filePath);
    }
  });
});

module.exports = app;
