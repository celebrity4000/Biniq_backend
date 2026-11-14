// Recomputes each store's true leaderboard position within its state and
// notifies owners when that position actually changes — e.g. "You moved
// from #4 to #2 in California" — rather than just "your score went up".
//
// Runs on its own schedule (hourly is plenty — this is a leaderboard
// position, not something that needs sub-hour precision). Wire into
// server.js the same way as restockAlerts:
//
//   const { updateStateRankings } = require("./cron/rankingUpdate");
//   cron.schedule("0 * * * *", updateStateRankings); // every hour

const Store = require("../models/Store");
const { notifyUser } = require("../utils/notify");

const updateStateRankings = async () => {
  try {
    const states = await Store.distinct("state", { state: { $ne: null } });

    for (const state of states) {
      const stores = await Store.find({ state })
        .select("_id user_id store_name bin_iq_score state_rank")
        .sort({ bin_iq_score: -1 });

      for (let i = 0; i < stores.length; i++) {
        const store = stores[i];
        const newRank = i + 1;
        const previousRank = store.state_rank;

        if (previousRank !== newRank) {
          await Store.updateOne(
            { _id: store._id },
            { $set: { state_rank: newRank, state_rank_updated_at: new Date() } },
          );

          // Don't notify the very first time a store gets ranked — there's
          // no "previous" position to compare to, so "you moved" wouldn't
          // make sense yet.
          if (previousRank != null) {
            const direction = newRank < previousRank ? "increased" : "decreased";
            notifyUser({
              userId: store.user_id,
              heading: `Store Ranking ${direction === "increased" ? "Increased" : "Decreased"}`,
              content:
                direction === "increased"
                  ? `${store.store_name} moved up to #${newRank} in ${state} (from #${previousRank}).`
                  : `${store.store_name} moved down to #${newRank} in ${state} (from #${previousRank}).`,
              type: "store_owner",
              event_type: direction === "increased" ? "ranking_increased" : "ranking_decreased",
              store_id: store._id,
            }).catch((err) => console.error("Rank change notification failed:", err.message));
          }
        }
      }
    }

    console.log(`State rankings updated for ${states.length} state(s)`);
  } catch (error) {
    console.error("Ranking update cron error:", error.message);
  }
};

module.exports = { updateStateRankings };