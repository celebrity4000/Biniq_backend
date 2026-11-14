const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

// A single owner reply, kept as a sub-document so we can timestamp it
// independently of the review itself.
const replySchema = new mongoose.Schema(
  {
    content: { type: String, required: true, trim: true },
    replied_by: { type: String, ref: "User", required: true }, // store owner's user_id
    created_at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const reviewSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  store_id: { type: String, ref: "Store", required: true, index: true },
  user_id: { type: String, ref: "User", required: true },
  user_name: { type: String, required: true },
  user_image: { type: String, default: null },

  rating: { type: Number, required: true, min: 1, max: 5 },
  content: { type: String, required: true, trim: true },

  // Only Paid Verified store owners are allowed to reply — enforced in the
  // controller, not here, since plan status can change after the reply exists.
  reply: { type: replySchema, default: null },

  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

// One review per user per store — resubmitting should edit, not duplicate.
reviewSchema.index({ store_id: 1, user_id: 1 }, { unique: true });

reviewSchema.pre("save", function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model("Review", reviewSchema);