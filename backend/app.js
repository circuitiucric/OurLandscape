// backend/app.js
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const app = express();
const indexRouter = require("./routes/index");

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "*");
  res.header("Content-Type", "application/json;charset=utf-8");
  next();
});

app.use("/pdf", express.static(path.join(__dirname, "public", "pdf")));

app.use("/", indexRouter);

module.exports = app;
