const { check, validationResult, param } = require("express-validator");
const { v4: uuidv4 } = require("uuid");
const Job = require("../models/Job");
const Store = require("../models/Store");
const { notifyStoreAudience } = require("../utils/notify");

// ─────────────────────────────────────────────────────────────────────────
// POST /api/jobs — store owner posts a job listing
// ─────────────────────────────────────────────────────────────────────────
const createJob = [
  check("title").notEmpty().withMessage("Title is required"),
  check("description").notEmpty().withMessage("Description is required"),
  check("employment_type")
    .optional()
    .isIn(["full_time", "part_time", "seasonal", "contract"])
    .withMessage("Invalid employment_type"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const userId = req.user.userId;
    const { title, description, pay_rate, employment_type } = req.body;

    try {
      const store = await Store.findOne({ user_id: userId });
      if (!store) {
        return res.status(404).json({ success: false, message: "You don't have a store yet" });
      }

      const job = new Job({
        _id: uuidv4(),
        store_id: store._id,
        user_id: userId,
        title,
        description,
        pay_rate: pay_rate || null,
        employment_type: employment_type || "full_time",
      });
      await job.save();

      // "Store Posted New Jobs" — reuses the same favorited/followed
      // (+ liked/checked-in for Paid Verified) fan-out as promotions/photos.
      notifyStoreAudience(store._id, {
        heading: "New Job Posted",
        content: `${store.store_name} is hiring: ${title}.`,
        event_type: "new_job",
      }).catch((err) => console.error("New job notification failed:", err.message));

      res.status(201).json({ success: true, message: "Job posted", job });
    } catch (error) {
      console.error("Create job error:", error);
      res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────
// GET /api/jobs/:store_id — public list of a store's open jobs
// ─────────────────────────────────────────────────────────────────────────
const getStoreJobs = [
  param("store_id").notEmpty().withMessage("Store ID is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    try {
      const jobs = await Job.find({ store_id: req.params.store_id, status: "open" }).sort({ created_at: -1 });
      res.json({ success: true, count: jobs.length, data: jobs });
    } catch (error) {
      console.error("Get store jobs error:", error);
      res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
  },
];

// ─────────────────────────────────────────────────────────────────────────
// GET /api/jobs/my-jobs — owner's own postings, any status
// ─────────────────────────────────────────────────────────────────────────
const getMyJobs = async (req, res) => {
  try {
    const jobs = await Job.find({ user_id: req.user.userId }).sort({ created_at: -1 });
    res.json({ success: true, count: jobs.length, data: jobs });
  } catch (error) {
    console.error("Get my jobs error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// PUT /api/jobs/:job_id — owner edits or closes their own job
// ─────────────────────────────────────────────────────────────────────────
const updateJob = async (req, res) => {
  const { job_id } = req.params;
  const userId = req.user.userId;

  try {
    const job = await Job.findOne({ _id: job_id, user_id: userId });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });

    const { title, description, pay_rate, employment_type, status } = req.body;
    if (title !== undefined) job.title = title;
    if (description !== undefined) job.description = description;
    if (pay_rate !== undefined) job.pay_rate = pay_rate;
    if (employment_type !== undefined) job.employment_type = employment_type;
    if (status !== undefined) job.status = status;

    await job.save();
    res.json({ success: true, message: "Job updated", job });
  } catch (error) {
    console.error("Update job error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/jobs/:job_id — owner deletes their own job
// ─────────────────────────────────────────────────────────────────────────
const deleteJob = async (req, res) => {
  const { job_id } = req.params;
  const userId = req.user.userId;

  try {
    const job = await Job.findOneAndDelete({ _id: job_id, user_id: userId });
    if (!job) return res.status(404).json({ success: false, message: "Job not found" });
    res.json({ success: true, message: "Job deleted" });
  } catch (error) {
    console.error("Delete job error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

module.exports = { createJob, getStoreJobs, getMyJobs, updateJob, deleteJob };