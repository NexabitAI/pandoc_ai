import 'dotenv/config.js';
import mongoose from 'mongoose';
import doctorModel from '../models/doctorModel.js';

// Names to delete (exact match, case-insensitive)
const TARGETS = ['Dr. Ava White'];

// Build ^name$ (case-insensitive) regex safely
const toExactRegex = (s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('Missing MONGO_URL in .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const query = { name: { $in: TARGETS.map(toExactRegex) } };

  // Preview what will be deleted
  const found = await doctorModel.find(query).select('_id name email speciality').lean();
  console.log('Will delete', found.length, 'doctor(s):');
  found.forEach(d => console.log(` - ${d._id} | ${d.name} | ${d.email} | ${d.speciality}`));

  // Delete
  const res = await doctorModel.deleteMany(query);
  console.log('Deleted count:', res.deletedCount);

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('Error:', e.message);
  try { await mongoose.disconnect(); } catch { }
  process.exit(1);
});
