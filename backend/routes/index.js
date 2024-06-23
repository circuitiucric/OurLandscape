const express = require("express");
const router = express.Router();
const Link = require("next/link"); // 将 import 替换为 require

router.get("/", function (req, res, next) {
  res.send("Hello World");
});

module.exports = router;
