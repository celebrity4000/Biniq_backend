// Sends the "24hr alert before Restock" push to a Paid Verified store's
// audience, one time, roughly 24 hours before next_restock_at.
//
// Not wired into server.js yet — you'll need to pick a scheduler. If the
// project doesn't already depend on one, `npm install node-cron` and add
// this near the bottom of server.js, after the DB connects:
//
//   const cron = require("node-cron");
//   const { sendDueRestockAlerts } = require("./cron/restockAlerts");
//   cron.schedule("*/15 * * * *", sendDueRestockAlerts); // every 15 min

const Store = require("../models/Store");
const { notifyStoreAudience } = require("../utils/notify");
const { isStorePaidVerified } = require("../utils/planStatus");

const sendDueRestockAlerts = async () => {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  // Small forward window so a 15-minute cron tick doesn't miss the target time.
  const windowEnd = new Date(in24h.getTime() + 15 * 60 * 1000);

  try {
    const dueStores = await Store.find({
      next_restock_at: { $gte: in24h, $lt: windowEnd },
      restock_alert_sent: { $ne: true },
    });

    for (const store of dueStores) {
      const { paidVerified } = await isStorePaidVerified(store.user_id);
      if (!paidVerified) continue; // this alert is a Paid Verified perk

      await notifyStoreAudience(store._id, {
        heading: "Restock Coming Tomorrow",
        content: `${store.store_name} restocks in about 24 hours.`,
        event_type: "restock_alert",
      });

      store.restock_alert_sent = true;
      await store.save();
    }

    if (dueStores.length) console.log(`Sent restock alerts for ${dueStores.length} store(s)`);
  } catch (error) {
    console.error("Restock alert cron error:", error.message);
  }
};

module.exports = { sendDueRestockAlerts };