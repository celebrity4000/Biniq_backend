const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const commentSchema = new mongoose.Schema({
  content: { type: String, required: true },
  user_id: { type: String, ref: "User", required: true },
  user_name: { type: String, required: true },
  user_image: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
});

// One optional price string per day of the week (null = no rate set)
const dailyRatesSchema = new mongoose.Schema(
  {
    Friday:    { type: String, default: null },
    Saturday:  { type: String, default: null },
    Sunday:    { type: String, default: null },
    Monday:    { type: String, default: null },
    Tuesday:   { type: String, default: null },
    Wednesday: { type: String, default: null },
    Thursday:  { type: String, default: null },
  },
  { _id: false },
);

const storeSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  user_id: { type: String, ref: "User", required: true, index: true },
  store_name: { type: String, required: true },
  user_latitude: { type: Number, default: null },
  user_longitude: { type: Number, default: null },
  address: { type: String, default: null },
  city: { type: String, default: null },
  state: { type: String, default: null },
  zip_code: { type: String, default: null },
  country: { type: String, default: null },
  google_maps_link: { type: String, default: null },
  website_url: { type: String, default: null },
  working_days: { type: String, default: null },
  working_time: { type: String, default: null },
  phone_number: { type: String, default: null },
  store_email: { type: String, default: null },
  facebook_link: { type: String, default: null },
  instagram_link: { type: String, default: null },
  twitter_link: { type: String, default: null },
  whatsapp_link: { type: String, default: null },
  followers: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  verified: { type: Boolean, default: false },
  checked_in_by: { type: [String], default: [] },
  store_image: { type: String, default: null },
  store_images: { type: [String], default: [] },
  ratings: { type: Number, default: 0 },
  rating_count: { type: Number, default: 0 },
  views_count: { type: Number, default: 0 },
  favorited_by: [{ type: String, ref: "User", default: [] }],
  liked_by: [{ type: String, ref: "User", default: [] }],
  followed_by: [{ type: String, ref: "User", default: [] }],
  comments: [commentSchema],
  daily_rates: { type: dailyRatesSchema, default: () => ({}) },

  // ── Milestone 2 additions ────────────────────────────────────────────
  // Single banner price shown instead of the full daily_rates list.
  // Falls back to today's entry in daily_rates when not explicitly set —
  // see utils/todayPrice.js.
  today_price: { type: String, default: null },
  today_price_updated_at: { type: Date, default: null },

  // Timestamp the owner marks when new stock arrives — drives the
  // "Favorite Store Restocked" push notification and the 24hr pre-restock alert.
  last_restocked_at: { type: Date, default: null },
  next_restock_at: { type: Date, default: null }, // used for the 24hr-before alert
  restock_alert_sent: { type: Boolean, default: false }, // reset to false whenever next_restock_at is set

  // Bin IQ Score™ — recalculated via utils/binIQScore.js whenever a scoring
  // input changes (check-in, like, follow, review). Cached here so
  // discovery/leaderboard queries can just sort on this field.
  bin_iq_score: { type: Number, default: 0, index: true },
  bin_iq_score_updated_at: { type: Date, default: null },

  // True leaderboard position within the store's state, recalculated by
  // cron/rankingUpdate.js. Distinct from bin_iq_score moving up/down —
  // this is the store's actual rank vs. every other store in its state.
  state_rank: { type: Number, default: null },
  state_rank_updated_at: { type: Date, default: null },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Store", storeSchema);