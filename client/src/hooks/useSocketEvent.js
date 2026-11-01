import { useEffect } from "react";
import { useSocket } from "../context/SocketContext";

export default function useSocketEvent(event, handler) {
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler);
    return () => socket.off(event, handler);
  }, [socket, event, handler]);
}
