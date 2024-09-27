const mysql = require("mysql2");

// 创建数据库连接池
const pool = mysql.createPool({
  host: "localhost", // 数据库地址
  user: "root", // 数据库用户名
  password: "xxhhqq007", // 数据库密码
  database: "pdf_website", // 数据库名称
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool.promise(); // 导出 Promise 版本的 pool
