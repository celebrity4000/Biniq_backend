const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const promotionSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  user_id: { type: String, ref: "User", required: true },
  category_id: { type: String, ref: "ProductCategory", required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  upc_id: { type: String, default: null },
  tags: [{ type: String }],
  created_at: { type: Date, default: Date.now },
  price: { type: Number, required: true },
  status: { type: String, enum: ["Active", "Inactive"], required: true },
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  banner_image: { type: String, default: null },
  visibility: { type: String, enum: ["On", "Off"], required: true },
  updated_at: { type: Date, default: Date.now },

  // ── Engagement counters (drive Promotion Views / CTR / Most Clicked) ──
  views: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },

  // ── Suggestion templates / auto-posts ──────────────────────────────
  // bin_price | restock | grand_opening | appreciation | featured | sale | hiring
  template: { type: String, default: null },
  auto_generated: { type: Boolean, default: false },
});

module.exports = mongoose.model("Promotion", promotionSchema);