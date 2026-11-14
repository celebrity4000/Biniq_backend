const StoreDailyStat = require("../models/StoreDailyStat");

const dayKey = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Fire-and-forget: never blocks or breaks the request that triggered it.
// field: "views" | "likes" | "followers" | "checkins" | "promo_views"
const bumpStat = (store_id, field, amount = 1) => {
  if (!store_id) return;
  StoreDailyStat.updateOne(
    { store_id: String(store_id), day: dayKey() },
    { $inc: { [field]: amount } },
    { upsert: true },
  ).catch((e) => console.error("bumpStat failed:", e.message));
};

// Records a store view + the unique viewer (skips the owner viewing their own store).
const trackView = (store, viewerId) => {
  if (!store) return;
  if (viewerId && String(store.user_id) === String(viewerId)) return;
  const update = { $inc: { views: 1 } };
  if (viewerId) update.$addToSet = { viewers: String(viewerId) };
  StoreDailyStat.updateOne(
    { store_id: String(store._id), day: dayKey() },
    update,
    { upsert: true },
  ).catch((e) => console.error("trackView failed:", e.message));
};

module.exports = { bumpStat, trackView, dayKey };