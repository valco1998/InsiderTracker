// Live SEC status strip. Every value comes from the API response
// (`status` of GET /insider/transactions) — nothing is simulated.
import { useEffect, useState } from "react";
import { ago, acceptedShort, count, shortDay } from "../../../utils/insiderFormat";
import { useInsider } from "../InsiderContext";

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function Item({ label, children, title }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5" title={title}>
      <span className="it-label">{label}</span>
      <span className="it-num text-[11.5px]" style={{ color: "var(--it-text-2)" }}>{children}</span>
    </span>
  );
}

export default function StatusBar() {
  const { feed, latestFiling } = useInsider();
  const { status, error, lastOkAt, newIds } = feed;
  const now = useNow();

  let dot = "it-dot-warn", text = "Connecting…";
  if (error && !status) { dot = "it-dot-err"; text = "API unreachable"; }
  else if (error) { dot = "it-dot-err"; text = "API unreachable · showing last data"; }
  else if (status?.lastPollError) { dot = "it-dot-err"; text = "SEC poll error · retrying"; }
  else if (status && (status.processing || status.queueLength > 0)) { dot = "it-dot-sync"; text = `Syncing SEC filings${status.queueLength ? ` · ${count(status.queueLength)} queued` : ""}`; }
  else if (status) {
    const stale = status.lastPollAt && status.pollIntervalMs && now - Date.parse(status.lastPollAt) > status.pollIntervalMs * 3;
    dot = stale ? "it-dot-warn" : "it-dot-live";
    text = stale ? "SEC poll delayed" : "Connected to SEC EDGAR";
  }

  const coverage = status?.coverage || [];
  return (
    <div className="it-statusbar">
      <div className="it-scroll-x mx-auto flex max-w-[1600px] items-center gap-5 px-4 py-1.5 sm:px-6" role="status" aria-live="polite">
        <span className="inline-flex shrink-0 items-center gap-2 text-[11.5px] font-medium" style={{ color: "var(--it-text)" }}>
          <span className={`it-dot ${dot}`} />
          {text}
        </span>
        {status && (
          <>
            <Item label="Last SEC poll" title={status.lastPollAt ? `Last successful SEC poll ${new Date(status.lastPollAt).toLocaleString()}${status.lastPollError ? `\nLast error: ${status.lastPollError}` : ""}` : "No successful SEC poll yet"}>
              {status.lastPollAt ? ago(status.lastPollAt, now) : "—"}
            </Item>
            <Item label="Latest filing" title="Newest SEC acceptance time among reported purchases/sales (Eastern Time)">
              {latestFiling ? acceptedShort(latestFiling) : "—"}
            </Item>
            <Item label="Form 4 scanned" title="Form 4 / 4/A filings downloaded and parsed from SEC EDGAR">{count(status.filingsStored)}</Item>
            {coverage.slice(0, 5).map((c) => (
              <Item key={c.day} label={shortDay(c.day)}
                title={`Official SEC daily index ${c.day}: ${c.listed} Form 4 filings · ${c.parsed} parsed · ${c.failed} failed · ${c.pending} pending`}>
                <span style={{ color: c.failed ? "var(--it-sell)" : c.pending ? "var(--it-warn)" : undefined }}>
                  {count(c.parsed)}/{count(c.listed)}
                </span>
              </Item>
            ))}
          </>
        )}
        {newIds.size > 0 && (
          <span className="inline-flex shrink-0 items-center rounded px-1.5 text-[11px] font-semibold" style={{ color: "var(--it-accent)", background: "var(--it-accent-soft)" }}>
            +{newIds.size} new {newIds.size === 1 ? "transaction" : "transactions"}
          </span>
        )}
        {lastOkAt && <span className="ml-auto hidden shrink-0 text-[11px] it-dim2 md:inline" title={new Date(lastOkAt).toLocaleString()}>Data refreshed {ago(lastOkAt, now)}</span>}
      </div>
    </div>
  );
}
