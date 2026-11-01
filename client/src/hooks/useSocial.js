import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../lib/api";
import useAuth from "./useAuth";
import { useSocket } from "../context/SocketContext";

/* Extract a readable message from an axios error or a plain Error. */
function extractError(e) {
  return e?.response?.data?.error || e?.message || "Something went wrong";
}

export default function useSocial() {
  const { user }   = useAuth();
  const { socket } = useSocket();

  const [friends,          setFriends]          = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [sentRequests,     setSentRequests]     = useState([]);
  const [blocked,          setBlocked]          = useState([]);
  const [blockedByIds,     setBlockedByIds]     = useState([]);
  const [loading,          setLoading]          = useState(false);

  /* Load all lists on mount */
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    setLoading(true);
    Promise.all([
      api.get("/social/friends").catch(() => ({ data: { friends: [] } })),
      api.get("/social/friends/requests").catch(() => ({ data: { incoming: [], sent: [] } })),
      api.get("/social/blocked").catch(() => ({ data: { blocked: [], blockedByIds: [] } })),
    ]).then(([fr, rq, bl]) => {
      if (!mounted) return;
      setFriends(fr.data?.friends ?? []);
      setIncomingRequests(rq.data?.incoming ?? []);
      setSentRequests(rq.data?.sent ?? []);
      setBlocked(bl.data?.blocked ?? []);
      setBlockedByIds(bl.data?.blockedByIds ?? []);
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [user]);

  /* Real-time socket events */
  useEffect(() => {
    if (!socket) return;

    const onRequest = ({ request }) => {
      setIncomingRequests(p =>
        p.some(r => r.requestId === request.requestId) ? p : [...p, request]
      );
    };

    const onAccepted = ({ friend }) => {
      setSentRequests(p => p.filter(r => r.userId !== friend.userId));
      setFriends(p => p.some(f => f.userId === friend.userId) ? p : [...p, friend]);
    };

    const onDeclined = ({ userId }) => {
      setSentRequests(p => p.filter(r => r.userId !== userId));
    };

    // Someone blocked me — update blockedByIds so our filter covers both directions immediately
    const onBlocked = ({ userId }) => {
      const id = String(userId);
      setBlockedByIds(p => p.includes(id) ? p : [...p, id]);
      setFriends(p => p.filter(f => f.userId !== id));
      setSentRequests(p => p.filter(r => r.userId !== id));
      setIncomingRequests(p => p.filter(r => r.userId !== id));
    };

    // Someone unblocked me
    const onUnblocked = ({ userId }) => {
      setBlockedByIds(p => p.filter(id => id !== String(userId)));
    };

    socket.on("friend_request",          onRequest);
    socket.on("friend_request:accepted", onAccepted);
    socket.on("friend_request:declined", onDeclined);
    socket.on("social:blocked",          onBlocked);
    socket.on("social:unblocked",        onUnblocked);

    return () => {
      socket.off("friend_request",          onRequest);
      socket.off("friend_request:accepted", onAccepted);
      socket.off("friend_request:declined", onDeclined);
      socket.off("social:blocked",          onBlocked);
      socket.off("social:unblocked",        onUnblocked);
    };
  }, [socket]);

  /* allBlockedIds: union of users I blocked + users who blocked me */
  const allBlockedIds = useMemo(() => {
    const s = new Set(blocked.map(u => u.userId));
    blockedByIds.forEach(id => s.add(String(id)));
    return s;
  }, [blocked, blockedByIds]);

  /* ── Actions — all return { ok, error? } so callers never get uncaught throws ── */

  const sendRequest = useCallback(async (userId) => {
    try {
      const res = await api.post(`/social/friends/request/${userId}`);
      if (res.data?.status === "pending" && res.data?.sentRequest) {
        setSentRequests(p =>
          p.some(r => r.userId === res.data.sentRequest.userId) ? p : [...p, res.data.sentRequest]
        );
      }
      if (res.data?.status === "accepted" && res.data?.friend) {
        setFriends(p => p.some(f => f.userId === res.data.friend.userId) ? p : [...p, res.data.friend]);
      }
      return { ok: true, data: res.data };
    } catch (e) {
      const error = extractError(e);
      console.error("[useSocial] sendRequest:", error);
      return { ok: false, error };
    }
  }, []);

  const acceptRequest = useCallback(async (userId) => {
    try {
      const res = await api.post(`/social/friends/accept/${userId}`);
      if (res.data?.friend) {
        setIncomingRequests(p => p.filter(r => r.userId !== userId));
        setFriends(p => p.some(f => f.userId === userId) ? p : [...p, res.data.friend]);
      }
      return { ok: true };
    } catch (e) {
      const error = extractError(e);
      console.error("[useSocial] acceptRequest:", error);
      return { ok: false, error };
    }
  }, []);

  const declineRequest = useCallback(async (userId) => {
    try {
      await api.delete(`/social/friends/decline/${userId}`);
      setIncomingRequests(p => p.filter(r => r.userId !== userId));
      return { ok: true };
    } catch (e) {
      const error = extractError(e);
      console.error("[useSocial] declineRequest:", error);
      return { ok: false, error };
    }
  }, []);

  const cancelRequest = useCallback(async (userId) => {
    try {
      await api.delete(`/social/friends/cancel/${userId}`);
      setSentRequests(p => p.filter(r => r.userId !== userId));
      return { ok: true };
    } catch (e) {
      const error = extractError(e);
      console.error("[useSocial] cancelRequest:", error);
      return { ok: false, error };
    }
  }, []);

  const removeFriend = useCallback(async (userId) => {
    try {
      await api.delete(`/social/friends/${userId}`);
      setFriends(p => p.filter(f => f.userId !== String(userId)));
      return { ok: true };
    } catch (e) {
      const error = extractError(e);
      console.error("[useSocial] removeFriend:", error);
      return { ok: false, error };
    }
  }, []);

  const blockUser = useCallback(async (userId, username = "", avatarUrl = "") => {
    try {
      await api.post(`/social/block/${userId}`);
      setFriends(p => p.filter(f => f.userId !== String(userId)));
      setSentRequests(p => p.filter(r => r.userId !== String(userId)));
      setIncomingRequests(p => p.filter(r => r.userId !== String(userId)));
      setBlocked(p =>
        p.some(b => b.userId === String(userId)) ? p : [...p, { userId: String(userId), username, avatarUrl }]
      );
      return { ok: true };
    } catch (e) {
      const error = extractError(e);
      console.error("[useSocial] blockUser:", error);
      return { ok: false, error };
    }
  }, []);

  const unblockUser = useCallback(async (userId) => {
    try {
      await api.delete(`/social/block/${userId}`);
      setBlocked(p => p.filter(b => b.userId !== String(userId)));
      return { ok: true };
    } catch (e) {
      const error = extractError(e);
      console.error("[useSocial] unblockUser:", error);
      return { ok: false, error };
    }
  }, []);

  const searchUsers = useCallback(async (q) => {
    if (!q || q.length < 2) return [];
    try {
      const res = await api.get(`/social/search?q=${encodeURIComponent(q)}`);
      const users = res.data?.users ?? [];
      return users.map(u => ({
        ...u,
        isFriend:           friends.some(f => f.userId === u.userId),
        isBlocked:          blocked.some(b => b.userId === u.userId),
        hasSentRequest:     sentRequests.some(r => r.userId === u.userId),
        hasIncomingRequest: incomingRequests.some(r => r.userId === u.userId),
      }));
    } catch (e) {
      console.error("[useSocial] searchUsers:", extractError(e));
      return [];
    }
  }, [friends, blocked, sentRequests, incomingRequests]);

  /* ── Convenience checks ── */
  const isFriend           = useCallback((uid) => friends.some(f => f.userId === String(uid)),          [friends]);
  const isBlocked          = useCallback((uid) => allBlockedIds.has(String(uid)),                       [allBlockedIds]);
  const hasSentRequest     = useCallback((uid) => sentRequests.some(r => r.userId === String(uid)),     [sentRequests]);
  const hasIncomingRequest = useCallback((uid) => incomingRequests.some(r => r.userId === String(uid)), [incomingRequests]);

  return {
    friends,
    incomingRequests,
    sentRequests,
    blocked,
    blockedByIds,
    allBlockedIds,
    loading,
    sendRequest,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriend,
    blockUser,
    unblockUser,
    searchUsers,
    isFriend,
    isBlocked,
    hasSentRequest,
    hasIncomingRequest,
  };
}
