const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const app = express();
const indexRouter = require("./routes/index");
const usersRouter = require("./routes/users");
const annotationsRouter = require("./routes/annotations");
const threadsRouter = require("./routes/threads");
const repliesRouter = require("./routes/replies");

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`); // 日志记录每个请求的方法和URL
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Content-Type", "application/json;charset=utf-8");
  next();
});

app.use("/pdf", express.static(path.join(__dirname, "public", "pdf")));
console.log(
  "Serving static files from:",
  path.join(__dirname, "public", "pdf")
);

app.use("/", indexRouter);
app.use("/api/users", usersRouter);
app.use("/api/annotations", annotationsRouter);
app.use("/api/threads", threadsRouter); // 确保已正确使用 threadsRouter
app.use("/api/replies", repliesRouter);

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

app.use((req, res, next) => {
  res.status(404).json({ error: "Not Found" });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal Server Error" });
});

module.exports = app;
