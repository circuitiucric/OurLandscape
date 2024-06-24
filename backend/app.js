const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const indexRouter = require("./routes/index");

const app = express();

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
console.log("Middleware setup complete."); // 调试信息

app.use("/", indexRouter);

module.exports = app;

require("dotenv").config(); //加载JWT Secret的环境变量
