const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Returns the price string to show on the "Today's Price" banner.
 * Priority: explicit today_price field (owner set it directly) →
 * today's entry in daily_rates (legacy per-day pricing) → null.
 */
const getTodayPrice = (store) => {
  if (store.today_price) return store.today_price;
  const todayName = DAY_NAMES[new Date().getDay()];
  return store.daily_rates?.[todayName] ?? null;
};

module.exports = { getTodayPrice };