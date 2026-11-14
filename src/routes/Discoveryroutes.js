const express = require("express");
const router = express.Router();
const { binFinder, getLeaderboard } = require("../controllers/discoveryController");

router.get("/finder", binFinder);           // public
router.get("/leaderboard", getLeaderboard); // public

module.exports = router;