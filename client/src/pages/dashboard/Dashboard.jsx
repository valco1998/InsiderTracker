import { useState } from "react";
import useSocketEvent from "../../hooks/useSocketEvent";

export default function Dashboard() {
  const [alerts, setAlerts] = useState([]);

  useSocketEvent("alert:new", (alert) => {
    setAlerts((prev) => [alert, ...prev]);
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Realtime Alerts</h1>

      {alerts.map((a, i) => (
        <div key={i} className="border p-3 rounded bg-gray-800">
          {a.message || JSON.stringify(a)}
        </div>
      ))}
    </div>
  );
}
