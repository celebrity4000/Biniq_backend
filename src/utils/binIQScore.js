const Store = require("../models/Store");
const Review = require("../models/Review");

// ── Weights ──────────────────────────────────────────────────────────────
// Tune these as real usage data comes in. Kept as named constants (not
// magic numbers inline) so the formula is easy to explain/adjust later.
const WEIGHTS = {
  checkIn: 2,      // per check-in
  follower: 1.5,   // per follower
  like: 1,         // per like
  review: 1.5,     // per review submitted
  avgRating: 3,     // per star, on the store's average rating (1-5)
  view: 0.05,       // per profile view — small, so it doesn't dominate
};

/**
 * Pure scoring function — no DB access — so it's easy to unit test.
 */
const computeScore = ({ checkIns, followers, likes, reviewCount, avgRating, views }) => {
  const score =
    checkIns * WEIGHTS.checkIn +
    followers * WEIGHTS.follower +
    likes * WEIGHTS.like +
    reviewCount * WEIGHTS.review +
    avgRating * WEIGHTS.avgRating +
    views * WEIGHTS.view;
  return Math.round(score * 100) / 100;
};

/**
 * Recalculates and saves a single store's Bin IQ Score.
 *
 * This only updates the score number — it does NOT fire a ranking
 * notification. Real leaderboard position (state_rank) only changes
 * relative to every other store in the state, so recomputing it on every
 * single like/follow/check-in/review would mean re-ranking the whole state
 * on every write. Instead, cron/rankingUpdate.js recomputes state_rank for
 * everyone on a schedule and fires "moved from #4 to #2" notifications off
 * of real position changes — see that file.
 */
const recalcAndSaveBinIQScore = async (storeId) => {
  const store = await Store.findOne({ _id: storeId });
  if (!store) return null;

  const [reviewStats] = await Review.aggregate([
    { $match: { store_id: storeId } },
    { $group: { _id: null, count: { $sum: 1 }, avgRating: { $avg: "$rating" } } },
  ]);

  const checkIns = Array.isArray(store.checked_in_by) ? store.checked_in_by.length : 0;
  const reviewCount = reviewStats?.count || 0;
  const avgRating = reviewStats?.avgRating || 0;

  const newScore = computeScore({
    checkIns,
    followers: store.followers || 0,
    likes: store.likes || 0,
    reviewCount,
    avgRating,
    views: store.views_count || 0,
  });

  store.bin_iq_score = newScore;
  store.bin_iq_score_updated_at = new Date();
  // Keep the cached rating fields in sync while we're already here.
  store.ratings = Math.round(avgRating * 10) / 10;
  store.rating_count = reviewCount;
  await store.save();

  return store;
};

module.exports = { computeScore, recalcAndSaveBinIQScore };