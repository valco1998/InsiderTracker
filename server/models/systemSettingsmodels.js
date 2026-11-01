import SystemSettings from "./SystemSettings.model.js";

export async function ensureSystemSettingsDefaults() {
  const defaults = [
    { key: "alertEngine.intervalMs", value: 3000 },
    { key: "alerts.cooldownMinDefault", value: 5 },
  ];

  for (const row of defaults) {
    await SystemSettings.updateOne(
      { key: row.key },
      { $setOnInsert: { value: row.value } },
      { upsert: true }
    );
  }

  return true;
}
export default SystemSettings;