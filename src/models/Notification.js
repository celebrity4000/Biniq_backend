const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const notificationSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  user_id: { type: String, ref: "User", required: true },
  heading: { type: String, required: true },
  content: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
  type: {
    type: String,
    // "customer" added for Milestone 2 (restock/price/photo/promotion alerts
    // sent to favorited/followed users, who are neither resellers nor store
    // owners). Original three values kept exactly as they were.
    enum: ["reseller", "store_owner", "all", "customer"],
    required: true,
  },
  read: { type: Boolean, default: false },

  // ── Milestone 2 additions (both optional — nothing existing depends on them) ──
  event_type: {
    type: String,
    enum: [
      "restock_alert",
      "store_restocked",
      "price_changed",
      "new_photos",
      "new_promotion",
      "new_job",
      "new_review",
      "new_check_in",
      "new_follower",
      "new_like",
      "ranking_increased",
      "ranking_decreased",
      "general",
    ],
    default: "general",
  },
  store_id: { type: String, ref: "Store", default: null },
});

// notificationSchema.index({ user_id: 1, read: 1 });
// notificationSchema.index({ created_at: -1 });

module.exports = mongoose.model("Notification", notificationSchema);