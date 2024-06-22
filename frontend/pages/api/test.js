// frontend/pages/api/test.js
import axios from "axios";

export default async function handler(req, res) {
  const response = await axios.get("http://localhost:3001/test-endpoint");
  res.status(200).json(response.data);
}
