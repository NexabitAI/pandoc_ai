import "dotenv/config.js";
import mongoose from "mongoose";
import doctorModel from "../models/doctorModel.js";

const MONGODB_URI = "mongodb://mypandocAppUser:nexabitai%40%232026@localhost:27017/mypandoc?authSource=mypandoc";
if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI in .env");
  process.exit(1);
}

const DAYS_AHEAD = 365;

const TIMES = [
  "10:00 AM",
  "02:00 PM",
  "05:00 PM",
  "10:00",
  "14:00",
  "17:00",
];

function dateKey(d) {
  return `${d.getDate()}_${d.getMonth() + 1}_${d.getFullYear()}`;
}

async function main() {
  await mongoose.connect(MONGODB_URI);

  await doctorModel.updateMany(
    { slots_booked: null },
    { $set: { slots_booked: {} } }
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const addToSet = {};
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() + i);
    const key = dateKey(dt);

    addToSet[`slots_booked.${key}`] = { $each: TIMES };
  }

  const res = await doctorModel.updateMany({}, { $addToSet: addToSet });

  console.log("Seed booked slots (1 year) complete.");
  console.log("matched:", res.matchedCount ?? 0);
  console.log("modified:", res.modifiedCount ?? 0);

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});

