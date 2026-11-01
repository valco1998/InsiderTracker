import UserFilter from "../models/UserFilter.model.js";

export async function getUserFilters(req, res) {
  const items = await UserFilter.find({ userId: req.user._id }).sort({ updatedAt: -1 });
  res.json({ ok: true, items });
}

export async function saveUserFilter(req, res) {
  const { name = "default", payload = {} } = req.body || {};
  const item = await UserFilter.findOneAndUpdate(
    { userId: req.user._id, name: String(name) },
    { $set: { payload } },
    { new: true, upsert: true }
  );

  res.json({ ok: true, item });
}
