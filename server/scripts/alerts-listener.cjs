const { io } = require("socket.io-client");

const socket = io("http://127.0.0.1:5055", {
  transports: ["polling","websocket"],
  path: "/socket.io",
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  timeout: 20000,
});

socket.on("connect", () => console.log("✅ Connected:", socket.id));
socket.on("alert", (msg) => console.log("🔔 ALERT", new Date().toLocaleTimeString(), JSON.stringify(msg)));
socket.on("connect_error", (e) => console.error("⚠️ connect_error:", e?.message || e));
socket.on("disconnect", (r) => console.log("❌ Disconnected:", r));
setInterval(() => {}, 1 << 30);
