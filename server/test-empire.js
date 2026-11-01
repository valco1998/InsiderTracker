import "dotenv/config";
import axios from "axios";

const baseURL = process.env.EMPIRE_BASE_URL; // https://csgoempire.com/api/v2
const apiKey = process.env.EMPIRE_API_KEY;

const http = axios.create({
  baseURL,
  timeout: Number(process.env.EMPIRE_TIMEOUT_MS || 12000),
  headers: {
    Accept: "application/json",
    "x-api-key": apiKey,          // ✅ הכי חשוב
    // Authorization: `Bearer ${apiKey}`, // ❌ אל תוסיף אם לא צריך
  },
});

try {
  const { data } = await http.get("/metadata/socket");
  console.log("OK:", data);
} catch (e) {
  console.log("STATUS:", e?.response?.status);
  console.log("CTYPE:", e?.response?.headers?.["content-type"]);
  console.log("DATA:", e?.response?.data || e.message);
}
