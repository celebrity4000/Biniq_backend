const User = require("../models/User");

/**
 * Attaches is_paid_verified to each store (needs Store.user_id in the
 * projection) by batch-fetching owners once, then sorts Paid Verified
 * stores first, then by Bin IQ Score descending.
 *
 * Works on plain objects (pass .lean() results or .toObject()'d docs).
 */
const applyFeaturedAndScoreSort = async (stores) => {
  if (!stores.length) return stores;

  const ownerIds = [...new Set(stores.map((s) => s.user_id).filter(Boolean))];
  const owners = ownerIds.length
    ? await User.find({ _id: { $in: ownerIds } }).select("_id verified status subscription_end_time")
    : [];

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

  const enriched = stores.map((s) => ({
    ...s,
    is_paid_verified: paidVerifiedOwnerIds.has(s.user_id),
  }));

  enriched.sort((a, b) => {
    if (a.is_paid_verified !== b.is_paid_verified) return a.is_paid_verified ? -1 : 1;
    return (b.bin_iq_score || 0) - (a.bin_iq_score || 0);
  });

  return enriched;
};

module.exports = { applyFeaturedAndScoreSort };