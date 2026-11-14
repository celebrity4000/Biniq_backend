const { check, validationResult, param } = require("express-validator");
const { v4: uuidv4 } = require("uuid");
const Review = require("../models/Review");
const Store = require("../models/Store");
const User = require("../models/User");
const { isStorePaidVerified } = require("../utils/planStatus");
const { recalcAndSaveBinIQScore } = require("../utils/binIQScore");
const { notifyUser } = require("../utils/notify");

// ─────────────────────────────────────────────────────────────────────────
// POST /api/reviews — submit or update your review for a store
// (unique index on store_id+user_id means a second submit edits in place)
// ─────────────────────────────────────────────────────────────────────────
const submitReview = [
  check("store_id").notEmpty().withMessage("Store ID is required"),
  check("rating").isInt({ min: 1, max: 5 }).withMessage("Rating must be 1-5"),
  check("content").notEmpty().withMessage("Review content is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { store_id, rating, content } = req.body;
    const userId = req.user.userId;

    try {
      const store = await Store.findOne({ _id: store_id });
      if (!store) return res.status(404).json({ success: false, message: "Store not found" });

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      const existing = await Review.findOne({ store_id, user_id: userId });

      let review;
      let isNew = false;
      if (existing) {
        existing.rating = rating;
        existing.content = content;
        await existing.save();
        review = existing;
      } else {
        isNew = true;
        review = new Review({
          _id: uuidv4(),
          store_id,
          user_id: userId,
          user_name: user.full_name,
          user_image: user.profile_image || null,
          rating,
          content,
        });
        await review.save();
      }

      await recalcAndSaveBinIQScore(store_id);

      if (isNew) {
        notifyUser({
          userId: store.user_id,
          heading: "New Review",
          content: `${user.full_name} left your store a ${rating}-star review.`,
          type: "store_owner",
          event_type: "new_review",
          store_id,
        }).catch((err) => console.error("New review notification failed:", err.message));
      }

      res.status(isNew ? 201 : 200).json({
        success: true,
        message: isNew ? "Review submitted" : "Review updated",
        review,
      });
    } catch (error) {
      console.error("Submit review error:", error);
      res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────
// GET /api/reviews/:store_id — public list of reviews for a store
// ─────────────────────────────────────────────────────────────────────────
const getStoreReviews = [
  param("store_id").notEmpty().withMessage("Store ID is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    try {
      const reviews = await Review.find({ store_id: req.params.store_id }).sort({ created_at: -1 });
      res.json({ success: true, count: reviews.length, data: reviews });
    } catch (error) {
      console.error("Get store reviews error:", error);
      res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────
// POST /api/reviews/:review_id/reply — Paid Verified store owner only,
// and only on their own store's reviews
// ─────────────────────────────────────────────────────────────────────────
const replyToReview = [
  param("review_id").notEmpty().withMessage("Review ID is required"),
  check("content").notEmpty().withMessage("Reply content is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const userId = req.user.userId;
    const { content } = req.body;

    try {
      const review = await Review.findOne({ _id: req.params.review_id });
      if (!review) return res.status(404).json({ success: false, message: "Review not found" });

      const store = await Store.findOne({ _id: review.store_id });
      if (!store) return res.status(404).json({ success: false, message: "Store not found" });

      if (store.user_id !== userId) {
        return res.status(403).json({ success: false, message: "You can only reply to reviews on your own store" });
      }

      const { paidVerified } = await isStorePaidVerified(userId);
      if (!paidVerified) {
        return res.status(403).json({
          success: false,
          message: "Replying to reviews is a Paid Verified feature. Upgrade your plan to reply.",
        });
      }

      review.reply = { content, replied_by: userId, created_at: new Date() };
      await review.save();

      res.json({ success: true, message: "Reply posted", review });
    } catch (error) {
      console.error("Reply to review error:", error);
      res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/reviews/:review_id — reviewer can delete their own review
// ─────────────────────────────────────────────────────────────────────────
const deleteReview = async (req, res) => {
  const { review_id } = req.params;
  const userId = req.user.userId;

  try {
    const review = await Review.findOne({ _id: review_id });
    if (!review) return res.status(404).json({ success: false, message: "Review not found" });
    if (review.user_id !== userId) {
      return res.status(403).json({ success: false, message: "You can only delete your own review" });
    }

    const { store_id } = review;
    await Review.deleteOne({ _id: review_id });
    await recalcAndSaveBinIQScore(store_id);

    res.json({ success: true, message: "Review deleted" });
  } catch (error) {
    console.error("Delete review error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
// final

module.exports = { submitReview, getStoreReviews, replyToReview, deleteReview };