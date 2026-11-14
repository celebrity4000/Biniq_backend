const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const jobSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  store_id: { type: String, ref: "Store", required: true, index: true },
  user_id: { type: String, ref: "User", required: true }, // store owner who posted it

  title: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  pay_rate: { type: String, default: null }, // free text, e.g. "$18-22/hr" — matches how daily_rates stores prices as strings
  employment_type: {
    type: String,
    enum: ["full_time", "part_time", "seasonal", "contract"],
    default: "full_time",
  },

  status: { type: String, enum: ["open", "closed"], default: "open" },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

jobSchema.pre("save", function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model("Job", jobSchema);