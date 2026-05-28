const fs = require("fs");
const key = fs.readFileSync(
  "./voyago-server-firebase-adminsdk-fbsvc-29ddd31702.json",
  "utf8",
);
const base64 = Buffer.from(key).toString("base64");
console.log(base64);
