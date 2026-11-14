// cron/autoPosts.js
// Auto-generates the free suggestion-template posts for every claimed store.
// Scheduled from server.js (see the snippet there). Uses node-cron, which you
// already have installed.
const Promotion = require("../models/Promotion");
const ProductCategory = require("../models/ProductCategory");
const Store = require("../models/Store");

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 24 * 60 * 60 * 1000;

const alreadyPosted = (user_id, template, since) =>
  Promotion.exists({ user_id, template, auto_generated: true, created_at: { $gte: since } });

const makePost = (store, category_id, template, title, description, days) =>
  Promotion.create({
    user_id: store.user_id,
    category_id,
    title,
    description,
    price: 0,
    status: "Active",
    visibility: "On",
    start_date: new Date(),
    end_date: new Date(Date.now() + days * DAY_MS),
    banner_image: store.store_image || (store.store_images && store.store_images[0]) || null,
    template,
    auto_generated: true,
  });

const generateAutoPosts = async () => {
  const category = await ProductCategory.findOne();
  if (!category) return console.warn("autoPosts: no category found, skipping");

  const now = new Date();
  const todayName = DAY_NAMES[now.getDay()];
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);

  // Claimed stores only (unclaimed ones have user_id "unassigned")
  const stores = await Store.find({ user_id: { $ne: "unassigned" } });

  for (const store of stores) {
    try {
      const uid = store.user_id;
      const name = store.store_name || "our store";
      const postCount = await Promotion.countDocuments({ user_id: uid });

      // 1) Grand Opening — the store's very first post
      if (postCount === 0) {
        await makePost(store, category._id, "grand_opening", "Grand Opening",
          `${name} is open! Come see what's new.`, 7);
        continue; // one post per store per run
      }

      // 2) Today's Bin Price — daily, from today_price or today's daily rate
      const rate = store.today_price || (store.daily_rates && store.daily_rates[todayName]);
      if (rate && !(await alreadyPosted(uid, "bin_price", startOfToday))) {
        await makePost(store, category._id, "bin_price", "Today's Bin Price",
          `Today's bin price at ${name}: ${rate}`, 1);
      }

      // 3) New Restock — when the next restock is within the next 24–48h
      const next = store.next_restock_at ? new Date(store.next_restock_at) : null;
      if (next && next > now && next - now <= 2 * DAY_MS
          && !(await alreadyPosted(uid, "restock", new Date(Date.now() - 3 * DAY_MS)))) {
        await makePost(store, category._id, "restock", "New Restock",
          `Fresh stock lands at ${name} soon — be first in line!`, 2);
      }

      // 4) Customer Appreciation — from the second post onwards, at most weekly
      if (postCount >= 1 && !(await alreadyPosted(uid, "appreciation", weekAgo))) {
        await makePost(store, category._id, "appreciation", "Customer Appreciation",
          `Thank you for shopping at ${name}!`, 3);
      }
    } catch (e) {
      console.error("autoPosts store error:", String(store._id), e.message);
    }
  }
  console.log("autoPosts run complete");
};

module.exports = { generateAutoPosts };