import type { NextApiRequest, NextApiResponse } from "next";
import db from "../../../../../backend/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (req.method === "GET") {
    try {
      const [rows] = await db.query(
        "SELECT * FROM replies WHERE thread_id = ?",
        [id]
      );
      res.send(rows);
    } catch (error) {
      console.error("Error fetching replies:", error);
      res.status(500).send({ error: "Internal Server Error" });
    }
  }
}
