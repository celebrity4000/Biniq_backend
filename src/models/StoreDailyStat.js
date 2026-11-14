const mongoose = require("mongoose");

// One row per store per calendar day. Powers "Today's …" / "Weekly …" numbers.
const storeDailyStatSchema = new mongoose.Schema({
  store_id: { type: String, required: true, index: true },
  day: { type: String, required: true }, // "YYYY-MM-DD" (server time)
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  followers: { type: Number, default: 0 },
  checkins: { type: Number, default: 0 },
  promo_views: { type: Number, default: 0 },
  viewers: { type: [String], default: [] }, // unique user ids that viewed the store today
});
storeDailyStatSchema.index({ store_id: 1, day: 1 }, { unique: true });

module.exports = mongoose.model("StoreDailyStat", storeDailyStatSchema);