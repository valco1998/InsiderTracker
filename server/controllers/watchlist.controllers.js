import WatchRule from "../server/models/WatchRule.model.js";

export async function listWatch(req, res) {
  const items = await WatchRule.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({ ok: true, items });
}

export async function createWatch(req, res) {
  const { query, cooldownMin = 5, appId = 730 } = req.body || {};
  if (!query) return res.status(400).json({ ok: false, error: "query is required" });

  const doc = await WatchRule.create({
    userId: req.user._id,
    query: String(query),
    cooldownMin: Number(cooldownMin) || 5,
    appId: Number(appId) || 730,
  });

  res.json({ ok: true, item: doc });
}

export async function deleteWatch(req, res) {
  const { id } = req.params;
  await WatchRule.deleteOne({ _id: id, userId: req.user._id });
  res.json({ ok: true });
}
