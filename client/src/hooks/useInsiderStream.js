// Insider Tracker — React bindings for the SSE connection (utils/insiderLiveStream.js).
//   useLiveStream()            one connection per provider (started on mount)
//   useLiveState(live)         full state — re-renders on every heartbeat (status strip only)
//   useLiveSelect(live, sel)   a single derived primitive — re-renders only when it changes
import { useEffect, useState, useSyncExternalStore } from "react";
import { API_BASE } from "../lib/config";
import { createLiveStream } from "../utils/insiderLiveStream";

export function useLiveStream() {
  const [live] = useState(() => createLiveStream(`${API_BASE}/insider/stream`));
  useEffect(() => { live.start(); return () => live.stop(); }, [live]);
  return live;
}

export function useLiveState(live) {
  return useSyncExternalStore(live.subscribe, live.getState);
}

export function useLiveSelect(live, select) {
  return useSyncExternalStore(live.subscribe, () => select(live.getState()));
}
