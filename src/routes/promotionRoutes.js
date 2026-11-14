const express = require("express");
const {
  createPromotion,
  getPromotions,
  updatePromotion,
  deletePromotion,
  trackPromotionView,
  trackPromotionClick,
} = require("../controllers/promotionController");
const { authenticate } = require("../utils/auth");

const router = express.Router();

router.post("/", authenticate, ...createPromotion);
router.get("/", authenticate, getPromotions);
router.put("/:promotion_id", authenticate, ...updatePromotion);
router.delete("/:promotion_id", authenticate, deletePromotion);
router.post("/:promotion_id/view", authenticate, trackPromotionView);
router.post("/:promotion_id/click", authenticate, trackPromotionClick);

module.exports = router;