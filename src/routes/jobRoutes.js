const express = require("express");
const router = express.Router();
const { authenticate } = require("../utils/auth");
const {
  createJob,
  getStoreJobs,
  getMyJobs,
  updateJob,
  deleteJob,
} = require("../controllers/jobController");

router.get("/my-jobs", authenticate, getMyJobs);
router.get("/:store_id", getStoreJobs); // public
router.post("/", authenticate, createJob);
router.put("/:job_id", authenticate, updateJob);
router.delete("/:job_id", authenticate, deleteJob);

module.exports = router;