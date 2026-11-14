const { check, validationResult } = require("express-validator");
const User = require("../models/User");

// PUT /api/users/push-token — called by the RN apps once on login/app-start
// after Notifications.getExpoPushTokenAsync().
const updatePushToken = [
  check("expo_push_token").notEmpty().withMessage("expo_push_token is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    try {
      const user = await User.findById(req.user.userId);
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      user.expo_push_token = req.body.expo_push_token;
      await user.save();

      res.json({ success: true, message: "Push token saved" });
    } catch (error) {
      console.error("Update push token error:", error);
      res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
  },
];

module.exports = { updatePushToken };