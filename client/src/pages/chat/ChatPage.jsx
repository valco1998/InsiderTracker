import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useChatContext } from "../../context/ChatContext";
import useSocial from "../../hooks/useSocial";
import ChatShell from "./ChatShell";

export default function ChatPage() {
  const chat            = useChatContext();
  const social          = useSocial();
  const [searchParams]  = useSearchParams();
  const navigate         = useNavigate();
  const openDMRef        = useRef(chat.openDM);
  openDMRef.current      = chat.openDM;

  const dmUserId    = searchParams.get("dm");
  const currentUserId = chat.currentUser?.id;

  useEffect(() => {
    if (!dmUserId) return;
    if (!currentUserId) return; // wait until auth/user is resolved
    if (dmUserId === currentUserId) {
      // Never DM yourself — just drop the param.
      navigate("/chat", { replace: true });
      return;
    }
    console.log("[TRADE_DM] opening recipient", dmUserId);
    openDMRef.current?.(dmUserId).finally(() => {
      navigate("/chat", { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmUserId, currentUserId]);

  return <ChatShell {...chat} social={social} />;
}
