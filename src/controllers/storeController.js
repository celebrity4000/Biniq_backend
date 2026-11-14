const { check, validationResult, param, query } = require("express-validator");
const Store = require("../models/Store");
const User = require("../models/User");
const { recalcAndSaveBinIQScore } = require("../utils/binIQScore");
const { notifyUser, notifyStoreAudience } = require("../utils/notify");
const { checkPhotoLimit } = require("../utils/photoLimit");
const { getTodayPrice } = require("../utils/todayPrice");
const StoreDailyStat = require("../models/StoreDailyStat");
const { bumpStat, trackView, dayKey } = require("../utils/dailyStats");
const { applyFeaturedAndScoreSort } = require("../utils/storeRanking");

// Haversine formula to calculate distance between two points (in km)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// ─────────────────────────────────────────────────────────────────────────────
// UUID-safe lookup — Store._id is a plain string, findById() casts to ObjectId
// and silently returns null. findOne({ _id }) does an exact string match.
// ─────────────────────────────────────────────────────────────────────────────
const findStoreById = (id) => Store.findOne({ _id: id });

// ─────────────────────────────────────────────────────────────────────────────
// Daily-rates validation
// ─────────────────────────────────────────────────────────────────────────────
const VALID_DAYS = [
  "Friday", "Saturday", "Sunday",
  "Monday", "Tuesday", "Wednesday", "Thursday",
];

const VALID_PRICES = [
  "25.00", "24.00", "23.00", "22.00", "21.00", "20.00",
  "19.00", "18.00", "17.00", "16.00", "15.00", "14.00",
  "13.00", "12.00", "11.00", "10.00", "9.00",  "8.00",
  "7.00",  "6.00",  "5.00",  "4.00",  "3.00",  "2.00",
  "1.00",  "0.50",
];

/**
 * Validate and sanitise a daily_rates payload.
 * Returns { valid: true, sanitised } or { valid: false, error }.
 */
const sanitiseDailyRates = (raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, error: "daily_rates must be a plain object" };
  }
  const sanitised = {};
  for (const [day, price] of Object.entries(raw)) {
    if (!VALID_DAYS.includes(day)) {
      return { valid: false, error: `Invalid day key in daily_rates: "${day}"` };
    }
    if (price !== null && !VALID_PRICES.includes(String(price))) {
      return {
        valid: false,
        error: `Invalid price "${price}" for ${day}. Allowed: ${VALID_PRICES.join(", ")} or null`,
      };
    }
    sanitised[day] = price ?? null;
  }
  return { valid: true, sanitised };
};

// ─────────────────────────────────────────────────────────────────────────────
// Geocoding helper for bulk store creation
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ Move this key to an environment variable (process.env.GOOGLE_MAPS_API_KEY)
// — it should never be hardcoded/committed, and definitely never shipped in the
// mobile app bundle the way it currently is in apiService.js / Dashboard2.js.
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate detection for bulk uploads
// ─────────────────────────────────────────────────────────────────────────────
const normalizeForDedupe = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
const dedupeKey = (name, city, state) =>
  `${normalizeForDedupe(name)}|${normalizeForDedupe(city)}|${normalizeForDedupe(state)}`;

// ─────────────────────────────────────────────────────────────────────────────
// Free geocoder — U.S. Census Bureau public Geocoder API
// ─────────────────────────────────────────────────────────────────────────────
const geocodeWithCensus = async (addressParts) => {
  const address = addressParts.filter(Boolean).join(", ");
  if (!address) return null;
  try {
    const url =
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
      `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url);
    const json = await res.json();
    const match = json?.result?.addressMatches?.[0];
    if (match?.coordinates?.y != null && match?.coordinates?.x != null) {
      return { latitude: match.coordinates.y, longitude: match.coordinates.x };
    }
  } catch (err) {
    console.error("Census geocode error for", address, err.message);
  }
  return null; // no match — caller falls back to Google
};

const geocodeAddress = async (addressParts) => {
  const address = addressParts.filter(Boolean).join(", ");
  if (!address || !GOOGLE_MAPS_API_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address,
    )}&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status === "OK" && json.results?.length > 0) {
      const { lat, lng } = json.results[0].geometry.location;
      return { latitude: lat, longitude: lng };
    }
    if (json.status === "OVER_QUERY_LIMIT") {
      return { rateLimited: true };
    }
  } catch (err) {
    console.error("Geocode error for", address, err.message);
  }
  return null;
};

const geocodeDocsInPlace = async (docs) => {
  let censusHits = 0;
  let googleFallbacks = 0;

  for (const doc of docs) {
    if (doc.user_latitude && doc.user_longitude) continue;
    if (!doc.address && !doc.city) continue;

    let result = await geocodeWithCensus([doc.address, doc.city, doc.state, doc.zip_code]);
    if (result) {
      censusHits++;
    } else {
      googleFallbacks++;
      let googleResult = await geocodeAddress([doc.address, doc.city, doc.state, doc.zip_code, doc.country]);
      if (googleResult?.rateLimited) {
        await sleep(1200);
        googleResult = await geocodeAddress([doc.address, doc.city, doc.state, doc.zip_code, doc.country]);
      }
      if (googleResult && !googleResult.rateLimited) result = googleResult;
    }

    if (result) {
      doc.user_latitude = result.latitude;
      doc.user_longitude = result.longitude;
    }
    await sleep(80);
  }

  console.log(`Geocoding summary: ${censusHits} resolved free via Census, ${googleFallbacks} fell back to Google`);
  return docs;
};

// ─────────────────────────────────────────────────────────────────────────────
// CREATE STORE
// ─────────────────────────────────────────────────────────────────────────────
const createStore = [
  check("user_latitude")
    .optional()
    .isFloat()
    .withMessage("User latitude must be a number"),
  check("user_longitude")
    .optional()
    .isFloat()
    .withMessage("User longitude must be a number"),
  check("address").optional().notEmpty().withMessage("Address cannot be empty"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const {
      store_name,
      user_latitude,
      user_longitude,
      address,
      city,
      state,
      zip_code,
      country,
      google_maps_link,
      website_url,
      working_days,
      working_time,
      phone_number,
      store_email,
      facebook_link,
      instagram_link,
      twitter_link,
      whatsapp_link,
      store_image,
      store_images,
      daily_rates,
    } = req.body;

    let sanitisedRates = {};
    if (daily_rates != null) {
      const result = sanitiseDailyRates(daily_rates);
      if (!result.valid)
        return res.status(400).json({ message: result.error });
      sanitisedRates = result.sanitised;
    }

    try {
      let store = await Store.findOne({ user_id: req.user.userId });
      let user = await User.findById(req.user.userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (store)
        return res
          .status(400)
          .json({ message: "Store already exists for this user" });

      // Photo limit — 1 free / 8 Paid Verified, enforced on create too.
      const requestedImages = Array.isArray(store_images) ? store_images : [];
      if (requestedImages.length > 0) {
        const { allowed, limit } = await checkPhotoLimit(req.user.userId, requestedImages.length);
        if (!allowed) {
          return res.status(403).json({
            message: `Your plan allows up to ${limit} photo(s). Upgrade to Paid Verified/Premium for up to 8.`,
          });
        }
      }

      store = new Store({
        _id: require("uuid").v4(),
        user_id: req.user.userId,
        store_name: store_name || user.store_name,
        user_latitude,
        user_longitude,
        address,
        city,
        state,
        zip_code,
        country,
        google_maps_link,
        website_url,
        working_days,
        working_time,
        phone_number,
        store_email,
        facebook_link,
        instagram_link,
        twitter_link,
        whatsapp_link,
        store_image,
        store_images: requestedImages,
        daily_rates: sanitisedRates,
        favorited_by: [],
        liked_by: [],
        followed_by: [],
        comments: [],
      });

      await store.save();
      res
        .status(201)
        .json({ store_id: store._id, message: "Store created successfully" });
    } catch (error) {
      console.error("Create store error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET STORE (own store for logged-in user)
// ─────────────────────────────────────────────────────────────────────────────
const getStore = async (req, res) => {
  try {
    const store = await Store.findOne({ user_id: req.user.userId });
    if (!store) return res.status(404).json({ message: "Store not found" });
    const storeObj = store.toObject();
    storeObj.today_price = getTodayPrice(storeObj);
    res.json(storeObj);
  } catch (error) {
    console.error("Get store error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/stores/my-store/stats — today / 7-day / previous-7-day numbers for
// the owner's dashboard. Built from StoreDailyStat (recorded going forward).
// ─────────────────────────────────────────────────────────────────────────────
const getMyStoreStats = async (req, res) => {
  try {
    const store = await Store.findOne({ user_id: req.user.userId });
    if (!store) return res.status(404).json({ message: "Store not found" });

    const today = new Date();
    const dayN = (n) => dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
    const thisWeek = Array.from({ length: 7 }, (_, i) => dayN(i));        // today … 6 days ago
    const lastWeek = Array.from({ length: 7 }, (_, i) => dayN(i + 7));    // 7 … 13 days ago

    const rows = await StoreDailyStat.find({
      store_id: String(store._id),
      day: { $in: [...thisWeek, ...lastWeek] },
    }).lean();

    const sum = (days, field) =>
      rows.filter((r) => days.includes(r.day)).reduce((t, r) => t + (r[field] || 0), 0);
    const todayRow = rows.find((r) => r.day === thisWeek[0]) || {};
    // Unique visitors (approximation: unique logged-in viewers)
    const uniq = (days) => new Set(rows.filter((r) => days.includes(r.day)).flatMap((r) => r.viewers || [])).size;

    const viewsThis = sum(thisWeek, "views");
    const viewsLast = sum(lastWeek, "views");
    const trafficChange = viewsLast > 0 ? ((viewsThis - viewsLast) / viewsLast) * 100 : null;

    res.json({
      today_views: todayRow.views || 0,
      today_likes: todayRow.likes || 0,
      today_followers: todayRow.followers || 0,
      today_checkins: todayRow.checkins || 0,
      today_visitors: (todayRow.viewers || []).length,
      weekly_visitors: uniq(thisWeek),
      weekly_views: viewsThis,
      weekly_likes: sum(thisWeek, "likes"),
      weekly_followers: sum(thisWeek, "followers"),
      weekly_checkins: sum(thisWeek, "checkins"),
      weekly_promo_views: sum(thisWeek, "promo_views"),
      views_last_week: viewsLast,
      traffic_change: trafficChange,
      // aliases the app also understands
      views_today: todayRow.views || 0,
      views_this_week: viewsThis,
      likes_this_week: sum(thisWeek, "likes"),
      checkins_today: todayRow.checkins || 0,
    });
  } catch (error) {
    console.error("Get my store stats error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE STORE
// ─────────────────────────────────────────────────────────────────────────────
const updateStore = async (req, res) => {
  try {
    const { user_id: _ignored, daily_rates, ...rest } = req.body;
    const userId = req.user.userId;

    if (rest.store_images != null) {
      if (!Array.isArray(rest.store_images)) {
        return res.status(400).json({ message: "store_images must be an array of URLs" });
      }
      const { allowed, limit } = await checkPhotoLimit(userId, rest.store_images.length);
      if (!allowed) {
        return res.status(403).json({
          message: `Your plan allows up to ${limit} photo(s). Upgrade to Paid Verified/Premium for up to 8.`,
        });
      }
    }

    // Fetch the current doc first so we can diff for notification triggers.
    const existingStore = await Store.findOne({ user_id: userId });
    if (!existingStore) {
      return res.status(404).json({ message: "Store not found for this user" });
    }

    const updates = { ...rest, updated_at: Date.now() };

    if (daily_rates != null) {
      const result = sanitiseDailyRates(daily_rates);
      if (!result.valid)
        return res.status(400).json({ message: result.error });
      for (const [day, price] of Object.entries(result.sanitised)) {
        updates[`daily_rates.${day}`] = price;
      }
    }
    if (rest.today_price != null) {
      updates.today_price_updated_at = new Date();
    }

    const result = await Store.collection.updateOne(
      { user_id: userId },
      { $set: updates },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Store not found for this user" });
    }

    const updated = await Store.collection.findOne({ user_id: userId });

    // ── Notification triggers (fire-and-forget, don't block the response) ──
    const priceBefore = existingStore.today_price ?? getTodayPrice(existingStore.toObject());
    const priceAfter = updated.today_price ?? getTodayPrice(updated);
    if (priceBefore !== priceAfter) {
      notifyStoreAudience(existingStore._id, {
        heading: "Price Changed Today",
        content: `${existingStore.store_name}'s price today is now ${priceAfter ?? "unavailable"}.`,
        event_type: "price_changed",
      }).catch((err) => console.error("Price change notification failed:", err.message));
    }

    const imagesBefore = existingStore.store_images?.length || 0;
    const imagesAfter = updated.store_images?.length || 0;
    if (imagesAfter > imagesBefore) {
      notifyStoreAudience(existingStore._id, {
        heading: "New Photos Posted",
        content: `${existingStore.store_name} just posted new photos.`,
        event_type: "new_photos",
      }).catch((err) => console.error("New photos notification failed:", err.message));
    }

    updated.today_price = getTodayPrice(updated);
    res.json({ message: "Store updated successfully", store: updated });
  } catch (error) {
    console.error("Update store error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL STORES
// ─────────────────────────────────────────────────────────────────────────────
const getAllStores = async (req, res) => {
  try {
    const stores = await Store.find().lean();
    // Same ordering as /api/discovery/finder — Paid Verified stores first,
    // then highest Bin IQ Score — so it's consistent regardless of which
    // endpoint a given screen happens to call.
    const sorted = await applyFeaturedAndScoreSort(stores);
    res.json(sorted);
  } catch (error) {
    console.error("Get all stores error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// VIEW STORE
// ─────────────────────────────────────────────────────────────────────────────
const viewStore = [
  check("store_id").notEmpty().withMessage("Store ID is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { store_id } = req.body;
    try {
      const store = await findStoreById(store_id);
      if (!store) return res.status(404).json({ message: "Store not found" });
      store.views_count += 1;
      await store.save();
      trackView(store, req.user.userId);
      res.json({
        message: "Store view recorded",
        views_count: store.views_count,
      });
    } catch (error) {
      console.error("View store error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// LIKE STORE
// ─────────────────────────────────────────────────────────────────────────────
const likeStore = [
  check("store_id").notEmpty().withMessage("Store ID is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { store_id } = req.body;
    const userId = req.user.userId;

    try {
      const store = await findStoreById(store_id);
      if (!store) return res.status(404).json({ message: "Store not found" });

      if (!Array.isArray(store.liked_by)) store.liked_by = [];

      const isLiked = store.liked_by.some((id) => id.toString() === userId);
      if (isLiked) {
        store.liked_by = store.liked_by.filter(
          (id) => id.toString() !== userId,
        );
        store.likes = Math.max(0, store.likes - 1);
        await store.save();
        recalcAndSaveBinIQScore(store._id).catch((e) => console.error("Score recalc failed:", e.message));
        res.json({ message: "Store unliked", isLiked: false, likes: store.likes });
      } else {
        store.liked_by.push(userId);
        store.likes += 1;
        await store.save();
        bumpStat(store._id, "likes");
        recalcAndSaveBinIQScore(store._id).catch((e) => console.error("Score recalc failed:", e.message));
        notifyUser({
          userId: store.user_id,
          heading: "New Like",
          content: `${store.store_name} got a new like.`,
          type: "store_owner",
          event_type: "new_like",
          store_id: store._id,
        }).catch((e) => console.error("New like notification failed:", e.message));
        res.json({ message: "Store liked", isLiked: true, likes: store.likes });
      }
    } catch (error) {
      console.error("Like store error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW STORE
// ─────────────────────────────────────────────────────────────────────────────
const followStore = [
  check("store_id").notEmpty().withMessage("Store ID is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { store_id } = req.body;
    const userId = req.user.userId;

    try {
      const store = await findStoreById(store_id);
      if (!store) return res.status(404).json({ message: "Store not found" });

      if (!Array.isArray(store.followed_by)) store.followed_by = [];

      const isFollowed = store.followed_by.some(
        (id) => id.toString() === userId,
      );
      if (isFollowed) {
        store.followed_by = store.followed_by.filter(
          (id) => id.toString() !== userId,
        );
        store.followers = Math.max(0, store.followers - 1);
        await store.save();
        recalcAndSaveBinIQScore(store._id).catch((e) => console.error("Score recalc failed:", e.message));
        res.json({ message: "Store unfollowed", isFollowed: false, followers: store.followers });
      } else {
        store.followed_by.push(userId);
        store.followers += 1;
        await store.save();
        bumpStat(store._id, "followers");
        recalcAndSaveBinIQScore(store._id).catch((e) => console.error("Score recalc failed:", e.message));
        notifyUser({
          userId: store.user_id,
          heading: "New Follower",
          content: `${store.store_name} has a new follower.`,
          type: "store_owner",
          event_type: "new_follower",
          store_id: store._id,
        }).catch((e) => console.error("New follower notification failed:", e.message));
        res.json({ message: "Store followed", isFollowed: true, followers: store.followers });
      }
    } catch (error) {
      console.error("Follow store error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMMENT ON STORE
// ─────────────────────────────────────────────────────────────────────────────
const commentOnStore = [
  check("store_id").notEmpty().withMessage("Store ID is required"),
  check("content").notEmpty().withMessage("Comment content is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { store_id, content } = req.body;
    const userId = req.user.userId;

    try {
      const store = await findStoreById(store_id);
      if (!store) return res.status(404).json({ message: "Store not found" });

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const comment = {
        content,
        user_id: userId,
        user_name: user.full_name,
        user_image: user.profile_image || null,
        created_at: new Date(),
      };

      store.comments.push(comment);
      await store.save();
      res.json({ message: "Comment added", comment });
    } catch (error) {
      console.error("Comment on store error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET STORE DETAILS (public, by :store_id)
// ─────────────────────────────────────────────────────────────────────────────
const getStoreDetails = [
  param("store_id").notEmpty().withMessage("Store ID is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { store_id } = req.params;
    try {
      const store = await findStoreById(store_id);
      if (!store) return res.status(404).json({ message: "Store not found" });
      store.views_count += 1;
      await store.save();
      trackView(store, req.user.userId);
      const storeObj = store.toObject();
      storeObj.today_price = getTodayPrice(storeObj);
      res.json(storeObj);
    } catch (error) {
      console.error("Get store details error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// FAVORITE STORE
// ─────────────────────────────────────────────────────────────────────────────
const favoriteStore = [
  check("store_id").notEmpty().withMessage("Store ID is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { store_id } = req.body;
    const userId = req.user.userId;

    try {
      const store = await findStoreById(store_id);
      if (!store) return res.status(404).json({ message: "Store not found" });

      if (!Array.isArray(store.favorited_by)) store.favorited_by = [];

      const isFavorited = store.favorited_by.some(
        (id) => id.toString() === userId,
      );
      if (isFavorited) {
        store.favorited_by = store.favorited_by.filter(
          (id) => id.toString() !== userId,
        );
        await store.save();
        res.json({ message: "Store removed from favorites", isFavorited: false });
      } else {
        store.favorited_by.push(userId);
        await store.save();
        res.json({ message: "Store added to favorites", isFavorited: true });
      }
    } catch (error) {
      console.error("Favorite store error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET FAVORITE STORES (own)
// ─────────────────────────────────────────────────────────────────────────────
const getFavoriteStores = async (req, res) => {
  try {
    const stores = await Store.find({ favorited_by: req.user.userId }).select(
      "store_name address city user_latitude user_longitude views_count likes followers comments store_image store_images image daily_rates today_price",
    );
    res.json(stores);
  } catch (error) {
    console.error("Get favorite stores error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET FAVORITE STORES BY USER ID
// ─────────────────────────────────────────────────────────────────────────────
const getFavoriteStoresByUserId = [
  param("user_id").notEmpty().withMessage("User ID is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { user_id } = req.params;
    const authenticatedUser = await User.findById(req.user.userId);

    if (user_id !== req.user.userId && authenticatedUser.role !== 1) {
      return res.status(403).json({
        message:
          "Unauthorized: You can only view your own favorites or must be an admin",
      });
    }

    try {
      const stores = await Store.find({ favorited_by: user_id }).select(
        "store_name address city user_latitude user_longitude views_count likes followers comments store_image store_images image daily_rates today_price",
      );
      res.json(stores);
    } catch (error) {
      console.error("Get favorite stores by user ID error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET NEARBY STORES
// ─────────────────────────────────────────────────────────────────────────────
const getNearbyStores = [
  query("latitude")
    .isFloat({ min: -90, max: 90 })
    .withMessage("Latitude must be between -90 and 90"),
  query("longitude")
    .isFloat({ min: -180, max: 180 })
    .withMessage("Longitude must be between -180 and 180"),
  query("radius")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Radius must be a positive number"),
  query("limit")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Limit must be a positive integer"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { latitude, longitude, radius = 10, limit = 10 } = req.query;

    try {
      const stores = await Store.find({
        user_latitude: { $ne: null },
        user_longitude: { $ne: null },
      }).select("store_name user_latitude user_longitude user_id bin_iq_score");

      const userLat = parseFloat(latitude);
      const userLon = parseFloat(longitude);
      let nearbyStores = stores
        .map((store) => {
          const distance = calculateDistance(
            userLat, userLon,
            store.user_latitude, store.user_longitude,
          );
          return {
            ...store.toObject(),
            distance_km: parseFloat(distance.toFixed(2)),
          };
        })
        .filter((store) => store.distance_km <= parseFloat(radius))
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, parseInt(limit));

      if (nearbyStores.length === 0) {
        return res
          .status(200)
          .json({ message: `No stores found within ${radius} km`, stores: [] });
      }

      // Attach the Paid Verified badge for the UI, but deliberately keep
      // distance as the primary sort — reordering "nearby" results by
      // score would defeat the point of a proximity search. This is why
      // nearby stays separate from getAllStores/searchStores below.
      nearbyStores = await applyFeaturedAndScoreSort(nearbyStores);
      nearbyStores.sort((a, b) => a.distance_km - b.distance_km);

      res.json(nearbyStores);
    } catch (error) {
      console.error("Get nearby stores error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CHECK IN / OUT
// ─────────────────────────────────────────────────────────────────────────────
const checkInStore = [
  check("store_id").notEmpty().withMessage("Store ID is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { store_id } = req.body;
    const userId = req.user.userId;

    try {
      const store = await Store.findOne({ _id: store_id });
      if (!store) return res.status(404).json({ message: "Store not found" });

      if (!Array.isArray(store.checked_in_by)) store.checked_in_by = [];

      const isCheckedIn = store.checked_in_by.some(
        (id) => id.toString() === userId,
      );

      if (isCheckedIn) {
        store.checked_in_by = store.checked_in_by.filter(
          (id) => id.toString() !== userId,
        );
        await store.save();
        recalcAndSaveBinIQScore(store._id).catch((e) => console.error("Score recalc failed:", e.message));
        return res.json({ message: "Checked out successfully", isCheckedIn: false });
      } else {
        store.checked_in_by.push(userId);
        await store.save();
        bumpStat(store._id, "checkins");
        recalcAndSaveBinIQScore(store._id).catch((e) => console.error("Score recalc failed:", e.message));
        notifyUser({
          userId: store.user_id,
          heading: "New Check-in",
          content: `Someone checked in at ${store.store_name}.`,
          type: "store_owner",
          event_type: "new_check_in",
          store_id: store._id,
        }).catch((e) => console.error("New check-in notification failed:", e.message));
        return res.json({ message: "Checked in successfully", isCheckedIn: true });
      }
    } catch (error) {
      console.error("Check in store error:", error);
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET TOP STORES
// ─────────────────────────────────────────────────────────────────────────────
const getTopStores = async (req, res) => {
  try {
    const stores = await Store.aggregate([
      {
        $addFields: {
          popularity_score: { $add: ["$views_count", "$followers"] },
        },
      },
      { $sort: { popularity_score: -1 } },
      { $limit: 5 },
      {
        $project: {
          store_name: 1,
          address: 1,
          city: 1,
          views_count: 1,
          followers: 1,
          popularity_score: 1,
          store_image: 1,
          store_images: 1,
          ratings: 1,
          daily_rates: 1,
          today_price: 1,
          bin_iq_score: 1,
        },
      },
    ]);

    res.json({ success: true, count: stores.length, data: stores });
  } catch (error) {
    console.error("Get top stores error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET CHECKED-IN STORES
// ─────────────────────────────────────────────────────────────────────────────
const getCheckedInStores = async (req, res) => {
  try {
    const stores = await Store.find({
      checked_in_by: req.user.userId,
    }).select(
      "store_name address city user_latitude user_longitude store_image store_images image ratings likes followers daily_rates today_price",
    );
    res.json(stores);
  } catch (error) {
    console.error("Get checked-in stores error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// BULK CREATE STORES
// ─────────────────────────────────────────────────────────────────────────────

const bulkCreateStores = async (req, res) => {
  if (req.user.role !== 1) {
    return res.status(403).json({ message: "Admin access required" });
  }

  const { stores } = req.body;
  if (!Array.isArray(stores) || stores.length === 0) {
    return res.status(400).json({ message: "stores array is required" });
  }

  const BATCH_SIZE = 500;
  const results = { created: [], failed: [] };

  const validDocs = [];
  for (const storeData of stores) {
    const {
      store_name, address, city, state, zip_code, country,
      store_email, facebook_link, daily_rates,
    } = storeData;

    if (!store_name) {
      results.failed.push({ store_name: storeData.store_name ?? "(unknown)", reason: "store_name is required" });
      continue;
    }

    if (!address && !city) {
      results.failed.push({ store_name, reason: "Address or city is required so the store can be located on the map" });
      continue;
    }

    let sanitisedRates = {};
    if (daily_rates != null) {
      const result = sanitiseDailyRates(daily_rates);
      if (!result.valid) {
        results.failed.push({ store_name, reason: result.error });
        continue;
      }
      sanitisedRates = result.sanitised;
    }

    validDocs.push({
      _id:            require("uuid").v4(),
      user_id:        "unassigned",
      store_name,
      address:        address       || null,
      city:           city          || null,
      state:          state         || null,
      zip_code:       zip_code      || null,
      country:        country       || null,
      store_email:    store_email   || null,
      facebook_link:  facebook_link || null,
      user_latitude:  null,
      user_longitude: null,
      daily_rates:    sanitisedRates,
      verified:       false,
      favorited_by:   [],
      liked_by:       [],
      followed_by:    [],
      comments:       [],
    });
  }

  const existingStores = await Store.find({}, { store_name: 1, city: 1, state: 1 }).lean();
  const existingKeys = new Set(
    existingStores.map((s) => dedupeKey(s.store_name, s.city, s.state)),
  );

  const seenInBatch = new Set();
  const dedupedDocs = [];
  for (const doc of validDocs) {
    const key = dedupeKey(doc.store_name, doc.city, doc.state);
    if (existingKeys.has(key)) {
      results.failed.push({
        store_name: doc.store_name,
        reason: "Duplicate — a store with this name already exists in this city/state",
      });
      continue;
    }
    if (seenInBatch.has(key)) {
      results.failed.push({
        store_name: doc.store_name,
        reason: "Duplicate — appears more than once in this upload",
      });
      continue;
    }
    seenInBatch.add(key);
    dedupedDocs.push(doc);
  }

  await geocodeDocsInPlace(dedupedDocs);

  for (let i = 0; i < dedupedDocs.length; i += BATCH_SIZE) {
    const batch = dedupedDocs.slice(i, i + BATCH_SIZE);
    try {
      const inserted = await Store.insertMany(batch, { ordered: false });
      inserted.forEach(s => results.created.push({ store_name: s.store_name, store_id: s._id, geocoded: !!(s.user_latitude && s.user_longitude) }));
    } catch (err) {
      if (err.insertedDocs?.length) {
        err.insertedDocs.forEach(s => results.created.push({ store_name: s.store_name, store_id: s._id, geocoded: !!(s.user_latitude && s.user_longitude) }));
      }
      if (err.writeErrors?.length) {
        err.writeErrors.forEach(e => results.failed.push({
          store_name: batch[e.index]?.store_name ?? "(unknown)",
          reason: e.errmsg,
        }));
      }
    }
  }

  const ungeocodedCount = results.created.filter(s => !s.geocoded).length;

  res.status(207).json({
    message: `${results.created.length} stores created, ${results.failed.length} failed` +
      (ungeocodedCount > 0 ? `, ${ungeocodedCount} created without coordinates (bad/missing address — they won't appear in "near me" until fixed)` : ""),
    created: results.created,
    failed:  results.failed,
  });
};

// GET /api/stores/search?q=krazy  (public — no auth required)
const searchStores = async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2)
    return res.status(400).json({ message: "Query must be at least 2 characters" });

  try {
    const regex = { $regex: q.trim(), $options: "i" };
    const stores = await Store.find({
      $or: [
        { store_name: regex },
        { address:    regex },
        { city:       regex },
      ],
    }).select("_id store_name address city state user_id verified bin_iq_score").lean();

    // Search ordering isn't otherwise meaningful, so Paid Verified + score
    // sort applies here the same as getAllStores/discovery.
    const sorted = await applyFeaturedAndScoreSort(stores);
    res.json(sorted);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// RE-GEOCODE STORES MISSING COORDINATES (admin only)
// ─────────────────────────────────────────────────────────────────────────────
const regeocodeStores = async (req, res) => {
  if (req.user.role !== 1) {
    return res.status(403).json({ message: "Admin access required" });
  }

  try {
    const stores = await Store.find({
      $or: [
        { user_latitude: null },
        { user_longitude: null },
        { user_latitude: { $exists: false } },
        { user_longitude: { $exists: false } },
      ],
    });

    if (stores.length === 0) {
      return res.json({ message: "No stores are missing coordinates", updated: [], stillMissing: [] });
    }

    const docs = stores.map((s) => ({
      _id: s._id,
      address: s.address,
      city: s.city,
      state: s.state,
      zip_code: s.zip_code,
      country: s.country,
      user_latitude: s.user_latitude,
      user_longitude: s.user_longitude,
    }));

    await geocodeDocsInPlace(docs);

    const updated = [];
    const stillMissing = [];

    for (const doc of docs) {
      if (doc.user_latitude && doc.user_longitude) {
        await Store.updateOne(
          { _id: doc._id },
          { $set: { user_latitude: doc.user_latitude, user_longitude: doc.user_longitude } },
        );
        updated.push({ store_id: doc._id, latitude: doc.user_latitude, longitude: doc.user_longitude });
      } else {
        stillMissing.push({
          store_id: doc._id,
          address: doc.address,
          city: doc.city,
          state: doc.state,
          zip_code: doc.zip_code,
          country: doc.country,
        });
      }
    }

    res.json({
      message: `${updated.length} store(s) geocoded, ${stillMissing.length} still unresolved`,
      updated,
      stillMissing,
    });
  } catch (error) {
    console.error("Regeocode stores error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE STORE (single, admin only)
// ─────────────────────────────────────────────────────────────────────────────
const deleteStore = async (req, res) => {
  if (req.user.role !== 1) {
    return res.status(403).json({ message: "Admin access required" });
  }
  const { store_id } = req.params;
  try {
    const deleted = await Store.findOneAndDelete({ _id: store_id });
    if (!deleted) return res.status(404).json({ message: "Store not found" });
    res.json({ message: "Store deleted successfully", store_id });
  } catch (error) {
    console.error("Delete store error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE ALL STORES (admin only)
// ─────────────────────────────────────────────────────────────────────────────
const deleteAllStores = async (req, res) => {
  if (req.user.role !== 1) {
    return res.status(403).json({ message: "Admin access required" });
  }
  const { confirm } = req.body;
  if (confirm !== "DELETE ALL STORES") {
    return res.status(400).json({
      message: 'Confirmation required. Send { "confirm": "DELETE ALL STORES" } in the request body to proceed.',
    });
  }
  try {
    const result = await Store.deleteMany({});
    res.json({
      message: `Deleted ${result.deletedCount} store${result.deletedCount === 1 ? "" : "s"}`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Delete all stores error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MARK RESTOCKED (Milestone 2) — owner marks their store as freshly
// restocked; notifies favorited/followed customers immediately, and sets
// next_restock_at so the 24hr-before cron job (cron/restockAlerts.js) can
// alert Paid Verified stores' audience ahead of time.
// ─────────────────────────────────────────────────────────────────────────────
const markRestocked = [
  check("next_restock_at").optional().isISO8601().withMessage("next_restock_at must be a valid date"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const userId = req.user.userId;
    const { next_restock_at } = req.body;

    try {
      const store = await Store.findOne({ user_id: userId });
      if (!store) return res.status(404).json({ success: false, message: "Store not found for this user" });

      store.last_restocked_at = new Date();
      if (next_restock_at) {
        store.next_restock_at = new Date(next_restock_at);
        store.restock_alert_sent = false;
      }
      await store.save();

      await notifyStoreAudience(store._id, {
        heading: "Favorite Store Restocked",
        content: `${store.store_name} just restocked.`,
        event_type: "store_restocked",
      });

      res.json({ success: true, message: "Store marked as restocked and audience notified" });
    } catch (error) {
      console.error("Mark restocked error:", error);
      res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
  },
];

module.exports = {
  createStore,
  getStore,
  getMyStoreStats,
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
  markRestocked,
};