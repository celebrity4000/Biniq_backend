const { isStorePaidVerified } = require("./planStatus");

const FREE_PHOTO_LIMIT = 1;
const PAID_PHOTO_LIMIT = 8;

/**
 * Returns { allowed: boolean, limit: number, paidVerified: boolean }.
 * Call before saving an updated store_images array.
 */
const checkPhotoLimit = async (storeUserId, requestedImageCount) => {
  const { paidVerified } = await isStorePaidVerified(storeUserId);
  const limit = paidVerified ? PAID_PHOTO_LIMIT : FREE_PHOTO_LIMIT;
  return { allowed: requestedImageCount <= limit, limit, paidVerified };
};

module.exports = { checkPhotoLimit, FREE_PHOTO_LIMIT, PAID_PHOTO_LIMIT };