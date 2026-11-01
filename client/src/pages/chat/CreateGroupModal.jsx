import { useEffect, useState } from "react";

export default function CreateGroupModal({ isOpen, onClose, onCreate }) {
  const [groupName, setGroupName] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setGroupName("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function submit(e) {
    e.preventDefault();
    onCreate(groupName);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-cyan-500/[0.15] bg-[#1f2838] p-5 shadow-xl">
        <div className="text-2xl font-bold">Create group</div>
        <p className="text-sm text-white/45 mt-1">
          Start with the client structure first.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label className="text-sm text-white/65 block mb-2">
              Group name
            </label>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 outline-none placeholder:text-white/25"
              placeholder="For example: Knife Hunters"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="rounded-2xl bg-cyan-500 text-slate-950 px-4 py-2.5 text-sm font-semibold"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}