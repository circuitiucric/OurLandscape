const mysql = require("mysql2/promise");

// 创建数据库连接池
const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "xxhhqq007",
  database: "pdf_website",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;
