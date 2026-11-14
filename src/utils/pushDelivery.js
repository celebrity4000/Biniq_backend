// Sends a push via Expo's push API if — and only if — the user document
// has an expo_push_token. If your User model doesn't have that field yet,
// this silently does nothing (no crash, no wasted call) until you add it.
//
// To actually receive push tokens from the apps:
//   1. Add `expo_push_token: { type: String, default: null }` to User.js
//   2. In the RN apps, after Notifications.getExpoPushTokenAsync(), send
//      the token to something like PUT /api/users/push-token on login/app-start
//   3. That's it — this file will pick it up automatically from then on.
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

const sendPush = async (expoPushToken, { heading, content, data = {} }) => {
  if (!expoPushToken || typeof expoPushToken !== "string" || !expoPushToken.startsWith("ExponentPushToken")) {
    return; // no valid token — nothing to do yet
  }
  try {
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        to: expoPushToken,
        title: heading,
        body: content,
        data,
      }),
    });
  } catch (err) {
    // Push failures should never break the request that triggered them.
    console.error("Expo push send failed:", err.message);
  }
};

module.exports = { sendPush };