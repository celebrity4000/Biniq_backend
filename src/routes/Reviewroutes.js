const express = require("express");
const router = express.Router();
const { authenticate } = require("../utils/auth");
const {
  submitReview,
  getStoreReviews,
  replyToReview,
  deleteReview,
} = require("../controllers/reviewController");

router.get("/:store_id", getStoreReviews);            // public
router.post("/", authenticate, submitReview);
router.post("/:review_id/reply", authenticate, replyToReview);
router.delete("/:review_id", authenticate, deleteReview);

module.exports = router;