const mysql = require("mysql2/promise");

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "xxhhqq007",
  database: "pdf_website",
});

module.exports = db;
