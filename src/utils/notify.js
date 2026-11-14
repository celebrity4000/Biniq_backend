const { v4: uuidv4 } = require("uuid");
const Notification = require("../models/Notification");
const Store = require("../models/Store");
const User = require("../models/User");
const { sendPush } = require("./pushDelivery");
const { isStorePaidVerified } = require("./planStatus");

/**
 * Create a single notification. Also attempts a push send — see
 * utils/pushDelivery.js for why that's always safe to call even before
 * push tokens exist in your User model.
 */
const notifyUser = async ({ userId, heading, content, type, event_type = "general", store_id = null }) => {
  const notification = new Notification({
    _id: uuidv4(),
    user_id: userId,
    heading,
    content,
    type,
    event_type,
    store_id,
  });
  await notification.save();

  User.findById(userId)
    .select("expo_push_token")
    .then((user) => sendPush(user?.expo_push_token, { heading, content, data: { event_type, store_id } }))
    .catch((err) => console.error("Push lookup failed:", err.message));

  return notification;
};

/**
 * Bulk-create the same notification for many users at once (e.g. every
 * follower of a store). Uses insertMany for efficiency — a store with
 * thousands of followers shouldn't mean thousands of sequential writes.
 */
const notifyUsers = async (userIds, { heading, content, type, event_type = "general", store_id = null }) => {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const docs = uniqueIds.map((userId) => ({
    _id: uuidv4(),
    user_id: userId,
    heading,
    content,
    type,
    event_type,
    store_id,
  }));

  await Notification.insertMany(docs, { ordered: false });

  // Best-effort push fan-out — batched fetch of tokens, fire-and-forget sends.
  User.find({ _id: { $in: uniqueIds } })
    .select("_id expo_push_token")
    .then((users) => {
      users.forEach((u) => sendPush(u.expo_push_token, { heading, content, data: { event_type, store_id } }));
    })
    .catch((err) => console.error("Bulk push lookup failed:", err.message));

  return docs;
};

/**
 * Fan-out helper for the customer-facing store events: restock, price
 * change, new photos, new promotion, new job. Notifies the union of
 * favorited_by + followed_by for every store.
 *
 * For Paid Verified stores specifically, this also reaches liked_by and
 * checked_in_by users — this is what implements "Activity alerts to
 * favorites, liked and previously checked in visitors for Paid Verified
 * stores" from the roadmap. Rather than building a separate notification
 * pathway, a Paid Verified store's existing events (restock/price/photos/
 * promotion/job) simply reach a wider, more engaged audience than a free
 * store's do — which is also a meaningful, tangible Paid Verified perk.
 */
const notifyStoreAudience = async (storeId, { heading, content, event_type }) => {
  const store = await Store.findOne({ _id: storeId }).select(
    "favorited_by followed_by liked_by checked_in_by user_id",
  );
  if (!store) return [];

  let audience = [...(store.favorited_by || []), ...(store.followed_by || [])];

  const { paidVerified } = await isStorePaidVerified(store.user_id);
  if (paidVerified) {
    audience = [...audience, ...(store.liked_by || []), ...(store.checked_in_by || [])];
  }

  return notifyUsers([...new Set(audience)], { heading, content, type: "customer", event_type, store_id: storeId });
};

module.exports = { notifyUser, notifyUsers, notifyStoreAudience };