import { useState } from "react";

export default function MessageInput({ onSend }) {
  const [text, setText] = useState("");

  function submit() {
    const clean = String(text || "").trim();
    if (!clean) return;
    onSend(clean);
    setText("");
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/[0.03] px-3 py-3">
      <button className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70">
        +
      </button>

      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 bg-transparent outline-none text-sm placeholder:text-white/30"
        placeholder="Write a message..."
      />

      <button
        onClick={submit}
        className="rounded-2xl bg-cyan-500 text-slate-950 px-4 py-2 text-sm font-semibold hover:opacity-90"
      >
        Send
      </button>
    </div>
  );
}