const express = require("express");
const router = express.Router();
const {
  createStore,
  getStore,
  getMyStoreStats, // ← daily stats for the owner dashboard
  updateStore,
  getAllStores,
  viewStore,
  likeStore,
  followStore,
  commentOnStore,
  getStoreDetails,
  favoriteStore,
  getFavoriteStores,
  getFavoriteStoresByUserId,
  getNearbyStores,
  getTopStores,
  checkInStore,
  getCheckedInStores,
  bulkCreateStores,
  regeocodeStores,
  searchStores,
  deleteStore,
  deleteAllStores,
  markRestocked, // ← Milestone 2
} = require("../controllers/storeController");
const { authenticate } = require("../utils/auth");

router.get("/search", searchStores);
router.post("/", authenticate, createStore);
router.get("/my-store", authenticate, getStore);
router.get("/my-store/stats", authenticate, getMyStoreStats);
router.put("/", authenticate, updateStore);
router.get("/", authenticate, getAllStores);
router.post("/view", authenticate, viewStore);
router.post("/like", authenticate, likeStore);
router.post("/follow", authenticate, followStore);
router.post("/comment", authenticate, commentOnStore);
router.get("/details/:store_id", authenticate, getStoreDetails);
router.post("/favorite", authenticate, favoriteStore);
router.get("/favorites", authenticate, getFavoriteStores);
router.get("/favorites/:user_id", authenticate, getFavoriteStoresByUserId);
router.get("/nearby", authenticate, getNearbyStores);
router.get("/topPerformers", authenticate, getTopStores);
router.post("/checkin", authenticate, checkInStore);
router.get("/checkins", authenticate, getCheckedInStores);
router.post("/bulk-create", authenticate, bulkCreateStores);
router.post("/regeocode", authenticate, regeocodeStores);
router.post("/restock", authenticate, markRestocked); // ← Milestone 2
router.delete("/all", authenticate, deleteAllStores);
router.delete("/:id", authenticate, deleteStore);

module.exports = router;