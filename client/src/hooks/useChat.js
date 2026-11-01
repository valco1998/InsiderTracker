import { useCallback, useEffect, useRef, useState } from "react";
import { useSocket } from "../context/SocketContext";
import useAuth from "./useAuth";
import api from "../lib/api";

const TYPING_TIMEOUT = 3000;

function normalizeGroupApi(g) {
  return {
    id:        g.id || g._id,
    name:      g.name,
    ownerId:   g.ownerId,
    members:   g.members || [],
    createdAt: g.createdAt,
  };
}

export default function useChat() {
  const { socket, connected } = useSocket();
  const { user }              = useAuth();

  // ── Room state ───────────────────────────────────────────────────────────
  const [activeRoomId,   setActiveRoomId]   = useState("global");
  const [groups,         setGroups]         = useState([]);
  const [dms,            setDms]            = useState([]);  // DMConversation[]
  const [messagesByRoom, setMessagesByRoom] = useState({});  // roomId → msg[]
  const [typingByRoom,   setTypingByRoom]   = useState({});  // roomId → [{userId,username}]
  const [onlineUsers,    setOnlineUsers]    = useState([]);
  const [unreadByRoom,   setUnreadByRoom]   = useState({});  // roomId → count (groups/global)
  const [loading,        setLoading]        = useState(true);
  const [groupsLoading,  setGroupsLoading]  = useState(true);
  const [dmsLoading,     setDmsLoading]     = useState(true);
  const [error,          setError]          = useState(null);

  const activeRoomRef = useRef("global");
  const joinedRooms   = useRef(new Set());
  const isTyping      = useRef(false);
  const typingTimer   = useRef(null);
  const peerTimers    = useRef({});
  const groupsRef     = useRef([]);
  const dmsRef        = useRef([]);

  useEffect(() => { activeRoomRef.current = activeRoomId; }, [activeRoomId]);
  useEffect(() => { groupsRef.current = groups; },         [groups]);
  useEffect(() => { dmsRef.current    = dms;   },          [dms]);

  // ── Load groups ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setGroupsLoading(true);
    api.get("/chat/groups")
      .then(res => setGroups((res.data?.groups || []).map(normalizeGroupApi)))
      .catch(() => {})
      .finally(() => setGroupsLoading(false));
  }, [user]);

  // ── Load DM conversations ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setDmsLoading(true);
    api.get("/dm")
      .then(res => setDms(res.data?.conversations || []))
      .catch(() => {})
      .finally(() => setDmsLoading(false));
  }, [user]);

  // ── Join all rooms when socket is ready ──────────────────────────────────
  useEffect(() => {
    if (!socket || !connected) {
      joinedRooms.current.clear();
      isTyping.current = false;
      return;
    }

    if (!joinedRooms.current.has("global")) {
      socket.emit("chat:join", { roomId: "global" });
      joinedRooms.current.add("global");
    }

    for (const g of groupsRef.current) {
      const roomId = `group:${g.id}`;
      if (!joinedRooms.current.has(roomId)) {
        socket.emit("group:join", { groupId: g.id });
        joinedRooms.current.add(roomId);
        console.log("[CHAT_SOCKET] joined group", g.id);
      }
    }

    for (const dm of dmsRef.current) {
      const roomId = `dm:${dm.id}`;
      if (!joinedRooms.current.has(roomId)) {
        socket.emit("dm:join", { convId: dm.id });
        joinedRooms.current.add(roomId);
      }
    }
  }, [socket, connected, groups, dms]);

  // ── Socket event listeners ───────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    /* history: replace room message store (chat:join / group:join / dm:join) */
    const onHistory = ({ roomId, messages }) => {
      setMessagesByRoom(prev => ({ ...prev, [roomId]: messages }));
      if (roomId === "global") setLoading(false);
    };

    /* chat / group new message */
    const onMessage = (msg) => {
      if (msg.roomId?.startsWith("group:")) {
        console.log("[CHAT_SOCKET] group message received", msg.roomId);
      }
      setMessagesByRoom(prev => {
        const room = prev[msg.roomId] || [];
        if (room.some(m => m.id === msg.id)) return prev;
        return { ...prev, [msg.roomId]: [...room, msg] };
      });
      if (msg.roomId !== activeRoomRef.current) {
        setUnreadByRoom(prev => ({ ...prev, [msg.roomId]: (prev[msg.roomId] || 0) + 1 }));
      }
      clearPeerTimer(`${msg.roomId}:${msg.senderId}`);
      setTypingByRoom(prev => ({
        ...prev,
        [msg.roomId]: (prev[msg.roomId] || []).filter(u => u.userId !== msg.senderId),
      }));
    };

    /* system message */
    const onSystem = (msg) => {
      setMessagesByRoom(prev => {
        const room = prev[msg.roomId] || [];
        if (room.some(m => m.id === msg.id)) return prev;
        return { ...prev, [msg.roomId]: [...room, msg] };
      });
    };

    /* online users (global only) */
    const onOnlineUsers = ({ roomId, users }) => {
      if (roomId === "global") setOnlineUsers(users);
    };

    /* typing indicators (roomId-based, shared by chat/group/dm) */
    const onTyping = ({ userId, username, roomId }) => {
      if (!roomId) return;
      setTypingByRoom(prev => {
        const room = prev[roomId] || [];
        if (room.some(u => u.userId === userId)) return prev;
        return { ...prev, [roomId]: [...room, { userId, username }] };
      });
      const key = `${roomId}:${userId}`;
      clearPeerTimer(key);
      peerTimers.current[key] = setTimeout(() => {
        setTypingByRoom(prev => ({
          ...prev,
          [roomId]: (prev[roomId] || []).filter(u => u.userId !== userId),
        }));
      }, TYPING_TIMEOUT + 1000);
    };

    const onStopTyping = ({ userId, roomId }) => {
      if (!roomId) return;
      clearPeerTimer(`${roomId}:${userId}`);
      setTypingByRoom(prev => ({
        ...prev,
        [roomId]: (prev[roomId] || []).filter(u => u.userId !== userId),
      }));
    };

    /* DM: new message arriving in a DM room */
    const onDMMessage = (msg) => {
      setMessagesByRoom(prev => {
        const room = prev[msg.roomId] || [];
        if (room.some(m => m.id === msg.id)) return prev;
        return { ...prev, [msg.roomId]: [...room, msg] };
      });
      clearPeerTimer(`${msg.roomId}:${msg.senderId}`);
      setTypingByRoom(prev => ({
        ...prev,
        [msg.roomId]: (prev[msg.roomId] || []).filter(u => u.userId !== msg.senderId),
      }));
    };

    /* DM: conversation metadata updated (last message, unread count) */
    const onDMConversation = ({ conversation: conv }) => {
      setDms(prev => {
        const idx  = prev.findIndex(c => c.id === conv.id);
        const list = idx === -1 ? [conv, ...prev] : prev.map((c, i) => i === idx ? conv : c);
        return [...list].sort((a, b) =>
          new Date(b.lastMessageAt || b.createdAt || 0) -
          new Date(a.lastMessageAt || a.createdAt || 0)
        );
      });
      // Auto-subscribe to the DM room so future messages are received
      if (socket && connected && !joinedRooms.current.has(`dm:${conv.id}`)) {
        socket.emit("dm:join", { convId: conv.id });
        joinedRooms.current.add(`dm:${conv.id}`);
      }
    };

    /* DM: read (from another device of mine, or after markDMRead) */
    const onDMRead = ({ convId }) => {
      setDms(prev => prev.map(c => c.id === convId ? { ...c, myUnread: 0 } : c));
    };

    /* group events */
    const onGroupUpdated   = ({ group }) =>
      setGroups(prev => prev.map(g => g.id === group.id ? normalizeGroupApi(group) : g));

    const onGroupInvited   = ({ group }) => {
      const n = normalizeGroupApi(group);
      setGroups(prev => prev.some(g => g.id === n.id) ? prev : [n, ...prev]);
      if (socket && connected) {
        const roomId = `group:${n.id}`;
        if (!joinedRooms.current.has(roomId)) {
          socket.emit("group:join", { groupId: n.id });
          joinedRooms.current.add(roomId);
        }
      }
    };

    const onGroupRemoved   = ({ groupId }) => {
      setGroups(prev => prev.filter(g => g.id !== groupId));
      setActiveRoomId(cur => cur === `group:${groupId}` ? "global" : cur);
      joinedRooms.current.delete(`group:${groupId}`);
    };

    const onGroupDisbanded = ({ groupId }) => {
      setGroups(prev => prev.filter(g => g.id !== groupId));
      setActiveRoomId(cur => cur === `group:${groupId}` ? "global" : cur);
      joinedRooms.current.delete(`group:${groupId}`);
    };

    const onError = ({ message }) => {
      setError(message);
      setTimeout(() => setError(null), 5000); // auto-dismiss after 5 s
    };

    socket.on("chat:history",      onHistory);
    socket.on("chat:message",      onMessage);
    socket.on("chat:system",       onSystem);
    socket.on("chat:online_users", onOnlineUsers);
    socket.on("chat:typing",       onTyping);
    socket.on("chat:stop_typing",  onStopTyping);
    socket.on("dm:message",        onDMMessage);
    socket.on("dm:conversation",   onDMConversation);
    socket.on("dm:read",           onDMRead);
    socket.on("dm:typing",         onTyping);      // same handler — roomId already normalized
    socket.on("dm:stop_typing",    onStopTyping);  // same handler
    socket.on("group:updated",     onGroupUpdated);
    socket.on("group:invited",     onGroupInvited);
    socket.on("group:removed",     onGroupRemoved);
    socket.on("group:disbanded",   onGroupDisbanded);
    socket.on("chat:error",        onError);

    return () => {
      socket.off("chat:history",      onHistory);
      socket.off("chat:message",      onMessage);
      socket.off("chat:system",       onSystem);
      socket.off("chat:online_users", onOnlineUsers);
      socket.off("chat:typing",       onTyping);
      socket.off("chat:stop_typing",  onStopTyping);
      socket.off("dm:message",        onDMMessage);
      socket.off("dm:conversation",   onDMConversation);
      socket.off("dm:read",           onDMRead);
      socket.off("dm:typing",         onTyping);
      socket.off("dm:stop_typing",    onStopTyping);
      socket.off("group:updated",     onGroupUpdated);
      socket.off("group:invited",     onGroupInvited);
      socket.off("group:removed",     onGroupRemoved);
      socket.off("group:disbanded",   onGroupDisbanded);
      socket.off("chat:error",        onError);
    };
  }, [socket, connected]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function clearPeerTimer(key) {
    clearTimeout(peerTimers.current[key]);
    delete peerTimers.current[key];
  }

  // ── Select room ──────────────────────────────────────────────────────────
  const selectRoom = useCallback((roomId) => {
    setActiveRoomId(roomId);
    setUnreadByRoom(prev => ({ ...prev, [roomId]: 0 }));
    setError(null);

    if (socket && connected && !joinedRooms.current.has(roomId)) {
      if (roomId === "global") {
        socket.emit("chat:join", { roomId: "global" });
      } else if (roomId.startsWith("group:")) {
        socket.emit("group:join", { groupId: roomId.replace("group:", "") });
      } else if (roomId.startsWith("dm:")) {
        socket.emit("dm:join", { convId: roomId.replace("dm:", "") });
      }
      joinedRooms.current.add(roomId);
    }

    if (roomId.startsWith("dm:")) {
      const convId = roomId.replace("dm:", "");
      api.post(`/dm/${convId}/read`).catch(() => {});
      setDms(prev => prev.map(c => c.id === convId ? { ...c, myUnread: 0 } : c));
    }
  }, [socket, connected]);

  // ── Open / create a DM ───────────────────────────────────────────────────
  const openDM = useCallback(async (userId) => {
    try {
      const res  = await api.post(`/dm/${userId}`);
      const conv = res.data?.conversation;
      if (!conv) return null;
      setDms(prev => prev.some(c => c.id === conv.id) ? prev : [conv, ...prev]);
      selectRoom(`dm:${conv.id}`);
      return conv;
    } catch (e) {
      const serverMsg = e?.response?.data?.error;
      // Show a user-friendly version; don't expose raw API internals
      const friendly =
        serverMsg === "Cannot message a blocked user" ? "Cannot message a blocked user." :
        serverMsg === "User not found"                ? "User not found."                :
        serverMsg === "Cannot DM yourself"            ? "You cannot message yourself."  :
        serverMsg                                     ? serverMsg                       :
        "Could not open conversation.";
      console.error("[openDM]", serverMsg || e?.message);
      return { error: friendly }; // caller can inspect this
    }
  }, [selectRoom]);

  // ── Hide / delete a DM conversation (current user only) ─────────────────
  const hideDM = useCallback(async (convId) => {
    try {
      await api.delete(`/dm/${convId}`);
      setDms(prev => prev.filter(c => c.id !== convId));
      if (activeRoomRef.current === `dm:${convId}`) selectRoom("global");
      return { ok: true };
    } catch (e) {
      const error = e?.response?.data?.error || e?.message || "Could not remove conversation";
      console.error("[hideDM]", error);
      return { ok: false, error };
    }
  }, [selectRoom]);

  // ── Clear message history for current user only ───────────────────────────
  const clearDMHistory = useCallback(async (convId) => {
    try {
      await api.delete(`/dm/${convId}/messages`);
      // Clear local cache so the view is empty immediately
      setMessagesByRoom(prev => ({ ...prev, [`dm:${convId}`]: [] }));
      return { ok: true };
    } catch (e) {
      const error = e?.response?.data?.error || e?.message || "Could not clear messages";
      console.error("[clearDMHistory]", error);
      return { ok: false, error };
    }
  }, []);

  // ── Send message ─────────────────────────────────────────────────────────
  const sendMessage = useCallback((text) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    const roomId = activeRoomRef.current;

    if (roomId === "global" || roomId.startsWith("group:")) {
      if (!socket || !connected) return;
      if (roomId === "global") {
        socket.emit("chat:message", { roomId: "global", text: clean });
      } else {
        socket.emit("group:message", { groupId: roomId.replace("group:", ""), text: clean });
      }
    } else if (roomId.startsWith("dm:")) {
      const convId = roomId.replace("dm:", "");
      if (socket && connected) {
        // Primary: socket (faster, server persists and broadcasts)
        socket.emit("dm:message", { convId, text: clean });
      } else {
        // Fallback: HTTP POST — server persists and emits socket events server-side
        api.post(`/dm/${convId}/messages`, { text: clean }).catch(e => {
          console.error("[sendMessage] HTTP fallback failed:", e?.response?.data?.error || e?.message);
        });
      }
    }

    if (isTyping.current) {
      isTyping.current = false;
      clearTimeout(typingTimer.current);
      emitStopTyping(socket, roomId);
    }
  }, [socket, connected]);

  // ── Typing ───────────────────────────────────────────────────────────────
  const startTyping = useCallback(() => {
    if (!socket || !connected) return;
    const roomId = activeRoomRef.current;
    if (!isTyping.current) {
      isTyping.current = true;
      emitTyping(socket, roomId);
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      isTyping.current = false;
      emitStopTyping(socket, roomId);
    }, TYPING_TIMEOUT);
  }, [socket, connected]);

  const stopTyping = useCallback(() => {
    if (!socket || !isTyping.current) return;
    isTyping.current = false;
    clearTimeout(typingTimer.current);
    emitStopTyping(socket, activeRoomRef.current);
  }, [socket]);

  // ── Group CRUD ────────────────────────────────────────────────────────────
  const createGroup = useCallback(async (name, memberUsernames = []) => {
    const res   = await api.post("/chat/groups", { name, memberUsernames });
    const group = normalizeGroupApi(res.data.group);
    setGroups(prev => [group, ...prev]);
    if (socket && connected) {
      socket.emit("group:join", { groupId: group.id });
      joinedRooms.current.add(`group:${group.id}`);
    }
    setActiveRoomId(`group:${group.id}`);
    return group;
  }, [socket, connected]);

  const addMember = useCallback(async (groupId, username) => {
    const res     = await api.post(`/chat/groups/${groupId}/members`, { username });
    const updated = normalizeGroupApi(res.data.group);
    setGroups(prev => prev.map(g => g.id === groupId ? updated : g));
    return updated;
  }, []);

  const removeMember = useCallback(async (groupId, userId) => {
    const res     = await api.delete(`/chat/groups/${groupId}/members/${userId}`);
    const updated = normalizeGroupApi(res.data.group);
    setGroups(prev => prev.map(g => g.id === groupId ? updated : g));
    return updated;
  }, []);

  const leaveGroup = useCallback(async (groupId) => {
    if (!user) return;
    const uid = String(user._id || user.id || "");
    await api.delete(`/chat/groups/${groupId}/members/${uid}`);
    setGroups(prev => prev.filter(g => g.id !== groupId));
    joinedRooms.current.delete(`group:${groupId}`);
    if (activeRoomRef.current === `group:${groupId}`) setActiveRoomId("global");
  }, [user]);

  const disbandGroup = useCallback(async (groupId) => {
    await api.delete(`/chat/groups/${groupId}`);
    setGroups(prev => prev.filter(g => g.id !== groupId));
    joinedRooms.current.delete(`group:${groupId}`);
    if (activeRoomRef.current === `group:${groupId}`) setActiveRoomId("global");
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentUser = user ? {
    id:          String(user._id || user.id || ""),
    username:    user.username   || "",
    displayName: user.fullName   || user.username || "",
    avatarUrl:   user.avatarUrl  || "",
  } : null;

  const messages    = messagesByRoom[activeRoomId] || [];
  const typingUsers = typingByRoom[activeRoomId]   || [];
  const activeGroup = groups.find(g => `group:${g.id}` === activeRoomId) || null;
  const activeDM    = dms.find(c => `dm:${c.id}`  === activeRoomId) || null;

  return {
    activeRoomId, messages, onlineUsers, typingUsers,
    groups, activeGroup,
    dms, activeDM, dmsLoading,
    unreadByRoom,
    loading, groupsLoading, error, connected, currentUser,
    selectRoom, sendMessage, startTyping, stopTyping,
    hideDM, clearDMHistory,
    createGroup, addMember, removeMember, leaveGroup, disbandGroup,
    openDM,
  };
}

/* ── Typing emit helpers ── */
function emitTyping(socket, roomId) {
  if (roomId === "global") {
    socket.emit("chat:typing", { roomId: "global" });
  } else if (roomId.startsWith("group:")) {
    socket.emit("group:typing", { groupId: roomId.replace("group:", "") });
  } else if (roomId.startsWith("dm:")) {
    socket.emit("dm:typing", { convId: roomId.replace("dm:", "") });
  }
}

function emitStopTyping(socket, roomId) {
  if (roomId === "global") {
    socket.emit("chat:stop_typing", { roomId: "global" });
  } else if (roomId.startsWith("group:")) {
    socket.emit("group:stop_typing", { groupId: roomId.replace("group:", "") });
  } else if (roomId.startsWith("dm:")) {
    socket.emit("dm:stop_typing", { convId: roomId.replace("dm:", "") });
  }
}
