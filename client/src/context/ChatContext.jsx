import { createContext, useContext } from "react";
import useChat from "../hooks/useChat";

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  // All socket subscriptions live here — one instance for the whole app
  const chat = useChat();
  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
}

export function useChatContext() {
  return useContext(ChatContext);
}
