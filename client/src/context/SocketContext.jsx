import { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import useAuth from "../hooks/useAuth";
import { playTradeNotification } from "../utils/tradeSound";
import { SOCKET_URL } from "../lib/config";

const SocketContext = createContext(null);

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

function getUserIdFromToken(token) {
  const p = parseJwt(token);
  return p?._id || p?.id || p?.userId || p?.sub || null;
}

export function SocketProvider({ children }) {
  const { token, user } = useAuth();
  // Store socket in state so consumers re-render when it changes
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  // Ref so the stable socket handler always reads the latest preference
  const tradeAlertsEnabledRef = useRef(true);

  useEffect(() => {
    tradeAlertsEnabledRef.current = user?.tradeMatchAlertsEnabled !== false;
  }, [user?.tradeMatchAlertsEnabled]);

  useEffect(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
      setConnected(false);
      return;
    }

    // Don't create a second socket if token hasn't changed
    if (socketRef.current) return;

    const sock = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      upgrade: true,
      auth: { token },
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = sock;
    setSocket(sock); // expose to consumers immediately

    sock.on("connect", () => {
      setConnected(true);
      const userId = getUserIdFromToken(token);
      console.log(`[Socket] connected — socketId=${sock.id} socketUrl=${SOCKET_URL} userId=${userId}`);
      if (userId) {
        sock.emit("join_user", userId);
        console.log(`[Socket] emitted join_user → expecting server room=user:${userId}`);
      } else {
        console.warn("[Socket] ⚠️ could not join user room — userId missing from token payload", parseJwt(token));
      }
    });

    sock.on("price_alert", (alert) => {
      const clientReceivedAt = Date.now();

      // Compute true end-to-end latency if the server stamped _detectedAt
      const detectedAt = alert?._detectedAt ? Number(alert._detectedAt) : null;
      const e2eMs = detectedAt && detectedAt > 0 ? clientReceivedAt - detectedAt : null;

      console.log(
        `[CLIENT_RECEIVED] alertId=${alert?.id ?? "–"} item="${alert?.name ?? "–"}"` +
        (e2eMs !== null ? ` DETECTION_TO_CLIENT_MS=${e2eMs}` : "")
      );
      if (e2eMs !== null && e2eMs > 1000) {
        console.warn(`[LATENCY_WARNING] alert took ${e2eMs}ms detection→client (target <1000ms)`);
      }

      // Let the PipelineStats panel collect client-side end-to-end samples
      if (e2eMs !== null && e2eMs >= 0 && e2eMs < 60_000) {
        window.dispatchEvent(new CustomEvent("alert:latency", {
          detail: { ms: e2eMs, alertId: alert?.id },
        }));
      }

      window.dispatchEvent(new CustomEvent("price_alert", { detail: alert }));
    });

    sock.on("market:deals", (items) => {
      window.dispatchEvent(new CustomEvent("market:deals", { detail: items }));
    });

    sock.on("item_deleted", (payload) => {
      window.dispatchEvent(new CustomEvent("item_deleted", { detail: payload }));
    });

    sock.on("alert_expired", (payload) => {
      window.dispatchEvent(new CustomEvent("alert_expired", { detail: payload }));
    });

    sock.on("auctions:update", (items) => {
      window.dispatchEvent(new CustomEvent("auctions:update", { detail: items }));
    });

    sock.on("trade:new-post", (post) => {
      console.log(`[trade:feed] socket received trade:new-post — id=${post?.id} owner="${post?.ownerUsername}"`);
      window.dispatchEvent(new CustomEvent("trade:new-post", { detail: post }));
    });

    sock.on("trade:match", (payload) => {
      const notifId = payload?.notification?.id || "?";
      const sender  = payload?.notification?.senderUsername || "?";
      console.log(`[TRADE NOTIFS] socket received — notifId=${notifId} sender=${sender} alertsEnabled=${tradeAlertsEnabledRef.current}`);
      // Always dispatch so badge + notifications page update regardless of alert setting
      window.dispatchEvent(new CustomEvent("trade:match", { detail: payload }));
      if (tradeAlertsEnabledRef.current) playTradeNotification();
    });

    sock.on("trade:new-comment", (payload) => {
      window.dispatchEvent(new CustomEvent("trade:new-comment", { detail: payload }));
      playTradeNotification();
    });

    sock.on("trade:comment-added", (payload) => {
      window.dispatchEvent(new CustomEvent("trade:comment-added", { detail: payload }));
    });

    sock.on("disconnect", (reason) => {
      console.log("🔴 socket disconnected:", reason);
      setConnected(false);
    });

    sock.on("connect_error", (e) => {
      console.log("⚠️ socket connect_error:", e.message);
    });

    return () => {
      sock.removeAllListeners();
      sock.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [token]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
