import ChatMessageItem from "./ChatMessageItem";
import MessageInput from "./MessageInput";

export default function ChatWindow({ conversation, messages, onSendMessage }) {
  if (!conversation) {
    return (
      <div className="rounded-3xl border border-cyan-500/[0.12] bg-[#1a2133] min-h-[78vh] flex items-center justify-center text-white/50">
        Select a conversation
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-cyan-500/[0.12] bg-[#1a2133] min-h-[78vh] flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xl font-bold">{conversation.name}</div>
            <div className="text-sm text-white/45 mt-1">
              {conversation.type === "global" && "Everyone can join"}
              {conversation.type === "group" &&
                `${conversation.members?.length || 0} members`}
              {conversation.type === "private" && "Private conversation"}
            </div>
          </div>

          <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/55 uppercase">
            {conversation.type}
          </div>
        </div>
      </div>

      <div className="flex-1 p-5 space-y-4 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.08),_transparent_35%)]">
        {messages.map((message) => (
          <ChatMessageItem key={message.id} message={message} />
        ))}
      </div>

      <div className="p-4 border-t border-white/10">
        <MessageInput onSend={onSendMessage} />
      </div>
    </div>
  );
}