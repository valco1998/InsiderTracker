import axios from "axios";

const BASE_URL = "https://csgoempiremirror.com/api/v2";

export function createEmpireClient({ apiKey, bearerToken } = {}) {
  if (!apiKey && !bearerToken) throw new Error("Missing apiKey or bearerToken");

  const headers = {
    Accept: "application/json",
    "User-Agent": "AppCSNT/1.0",
  };

  // CSGOEmpire לפעמים עובד עם x-api-key, לפעמים Bearer (תלוי endpoint)
  if (apiKey) headers["x-api-key"] = apiKey;
  if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;

  const http = axios.create({
    baseURL: BASE_URL,
    timeout: 15000,
    headers,
  });

  return {
    async metadataSocket() {
      const { data } = await http.get("/metadata/socket");
      return data;
    },

    async getActiveTrades() {
      const { data } = await http.get("/trading/user/trades");
      return data;
    },

    async getActiveAuctions() {
      const { data } = await http.get("/trading/user/auctions");
      return data;
    },
  };
}
