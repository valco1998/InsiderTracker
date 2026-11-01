export default function EmptyState({ title = "Nothing here", hint = "" }) {
  return (
    <div className="border border-gray-800 rounded-xl p-6 text-gray-300">
      <div className="font-semibold">{title}</div>
      {hint && <div className="text-sm text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}
