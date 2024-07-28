import type { NextApiRequest, NextApiResponse } from "next";
import db from "../../../../backend/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (req.method === "GET") {
    try {
      const [rows] = await db.query("SELECT * FROM threads WHERE id = ?", [id]);
      if (rows.length === 0) {
        return res.status(404).send({ error: "Thread not found" });
      }
      res.send(rows[0]);
    } catch (error) {
      console.error("Error fetching thread:", error);
      res.status(500).send({ error: "Internal Server Error" });
    }
  }
}
