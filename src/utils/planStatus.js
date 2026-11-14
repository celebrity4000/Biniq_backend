const User = require("../models/User");

/**
 * A store is "Paid Verified" when its owner has an active, non-expired
 * subscription and verified === true. Mirrors the check already used in
 * subscriptionController.verifyStoreOwnerSubscription — kept in one place
 * so photo limits, discovery ordering, and review replies never drift.
 */
const isUserPaidVerified = (user) => {
  if (!user) return false;
  const notExpired =
    user.subscription_end_time && new Date(user.subscription_end_time) > new Date();
  return user.verified === true && user.status === "approved" && !!notExpired;
};

/**
 * Same check, but looked up by the store's owning user_id. Returns
 * { paidVerified, user } so callers that already need the user document
 * (e.g. sending a notification) don't have to fetch it twice.
 */
const isStorePaidVerified = async (storeUserId) => {
  const user = await User.findById(storeUserId).select(
    "verified status subscription_end_time",
  );
  return { paidVerified: isUserPaidVerified(user), user };
};

module.exports = { isUserPaidVerified, isStorePaidVerified };