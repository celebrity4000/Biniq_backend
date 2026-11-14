const { query, validationResult } = require("express-validator");
const Store = require("../models/Store");
const User = require("../models/User");
const { getTodayPrice } = require("../utils/todayPrice");

const PROJECTION =
  "store_name address city state user_latitude user_longitude store_image store_images " +
  "ratings rating_count views_count followers likes verified daily_rates today_price " +
  "bin_iq_score user_id";

/**
 * Attaches is_featured (Paid Verified owner) to each store so the apps can
 * show a badge, and resolves the today_price banner for each result.
 */
const enrichStores = async (stores) => {
  const ownerIds = [...new Set(stores.map((s) => s.user_id))];
  const owners = await User.find({ _id: { $in: ownerIds } }).select(
    "_id verified status subscription_end_time",
  );
  const now = new Date();
  const paidVerifiedOwnerIds = new Set(
    owners
      .filter(
        (u) =>
          u.verified === true &&
          u.status === "approved" &&
          u.subscription_end_time &&
          new Date(u.subscription_end_time) > now,
      )
      .map((u) => u._id),
  );

  return stores.map((s) => {
    const obj = s.toObject ? s.toObject() : s;
    return {
      ...obj,
      today_price: getTodayPrice(obj),
      is_paid_verified: paidVerifiedOwnerIds.has(obj.user_id),
    };
  });
};

// ─────────────────────────────────────────────────────────────────────────
// GET /api/discovery/finder — Bin Finder with filters
// Query params: state, city, min_rating, verified_only, q (name search)
// Featured (Paid Verified) stores are always sorted first, then by
// Bin IQ Score, matching "Display Featured Stores First" +
// "Display Top Ranked Stores first" for Paid Verified owners.
// ─────────────────────────────────────────────────────────────────────────
const binFinder = [
  query("min_rating").optional().isFloat({ min: 0, max: 5 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { state, city, min_rating, verified_only, q } = req.query;

    const filter = {};
    if (state) filter.state = state;
    if (city) filter.city = city;
    if (min_rating) filter.ratings = { $gte: parseFloat(min_rating) };
    if (verified_only === "true") filter.verified = true;
    if (q) filter.store_name = { $regex: q, $options: "i" };

    try {
      const stores = await Store.find(filter).select(PROJECTION).lean();
      const enriched = await enrichStores(stores);

      // Paid Verified first, then highest Bin IQ Score first.
      enriched.sort((a, b) => {
        if (a.is_paid_verified !== b.is_paid_verified) return a.is_paid_verified ? -1 : 1;
        return (b.bin_iq_score || 0) - (a.bin_iq_score || 0);
      });

      res.json({ success: true, count: enriched.length, data: enriched });
    } catch (error) {
      console.error("Bin finder error:", error);
      res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────
// GET /api/discovery/leaderboard?state=CA — top stores in a state by
// Bin IQ Score. Omit state for a national leaderboard.
// ─────────────────────────────────────────────────────────────────────────
const getLeaderboard = async (req, res) => {
  const { state, limit = 20 } = req.query;
  const filter = state ? { state } : {};

  try {
    const stores = await Store.find(filter)
      .select(PROJECTION)
      .sort({ bin_iq_score: -1 })
      .limit(parseInt(limit))
      .lean();

    const enriched = await enrichStores(stores);
    const ranked = enriched.map((s, i) => ({ rank: i + 1, ...s }));

    res.json({ success: true, state: state || "all", count: ranked.length, data: ranked });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

module.exports = { binFinder, getLeaderboard };