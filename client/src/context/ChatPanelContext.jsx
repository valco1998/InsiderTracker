import { createContext, useCallback, useContext, useState } from "react";

const ChatPanelContext = createContext(null);

export function ChatPanelProvider({ children }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close  = useCallback(() => setOpen(false), []);
  return (
    <ChatPanelContext.Provider value={{ open, toggle, close }}>
      {children}
    </ChatPanelContext.Provider>
  );
}

export function useChatPanel() {
  return useContext(ChatPanelContext);
}
