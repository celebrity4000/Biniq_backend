// jobs/autoPostsJob.js
// Auto-generates the suggestion-template posts for every store owner.
//   npm i node-cron
//   In server.js (after the DB connects):  require("./jobs/autoPostsJob").start();
//
// ⚠️ Store field names (daily_rates, highest_restock_day) and the Promotion
// `template` / `auto_generated` fields are assumptions — add them to the schemas
// (Promotion: template: String, auto_generated: Boolean) or adjust below.
const cron = require("node-cron");
const Promotion = require("../models/Promotion");
const ProductCategory = require("../models/ProductCategory");
const Store = require("../models/Store");

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 24 * 60 * 60 * 1000;

const alreadyPosted = (user_id, template, since) =>
  Promotion.exists({ user_id, template, created_at: { $gte: since } });

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
    banner_image: store.cover_photo || store.logo || null,
    template,
    auto_generated: true,
  });

const runOnce = async () => {
  const category = await ProductCategory.findOne();
  if (!category) return console.warn("autoPosts: no category found, skipping");

  const now = new Date();
  const todayName = DAY_NAMES[now.getDay()];
  const tomorrowName = DAY_NAMES[(now.getDay() + 1) % 7];
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);

  const stores = await Store.find({});
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

      // 2) Today's Bin Price — daily, only when a rate is set for today
      const rate = store.daily_rates && store.daily_rates[todayName];
      if (rate && !(await alreadyPosted(uid, "bin_price", startOfToday))) {
        await makePost(store, category._id, "bin_price", "Today's Bin Price",
          `Today's bin price at ${name}: ${rate}`, 1);
      }

      // 3) New Restock — the day before the store's highest restock day
      const restockDay = store.highest_restock_day;
      if (restockDay && String(restockDay).toLowerCase() === tomorrowName.toLowerCase()
          && !(await alreadyPosted(uid, "restock", startOfToday))) {
        await makePost(store, category._id, "restock", "New Restock",
          `Fresh stock lands at ${name} tomorrow — be first in line!`, 2);
      }

      // 4) Customer Appreciation — from the second post onwards, at most weekly
      if (postCount >= 1 && !(await alreadyPosted(uid, "appreciation", weekAgo))) {
        await makePost(store, category._id, "appreciation", "Customer Appreciation",
          `Thank you for shopping at ${name}!`, 3);
      }
    } catch (e) {
      console.error("autoPosts store error:", store._id?.toString(), e.message);
    }
  }
};

// Every day at 06:00 server time
const start = () => cron.schedule("0 6 * * *", () => runOnce().catch((e) => console.error("autoPosts error:", e.message)));

module.exports = { start, runOnce };