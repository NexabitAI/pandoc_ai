import 'dotenv/config.js';
import mongoose from 'mongoose';
import doctorModel from '../models/doctorModel.js';

const FEMALE_INDEXES = new Set([2,5,9,11,13,15]);

function imageIndexFromUrl(url='') {
  // expect .../hms/doctors/docN.png
  const m = url.match(/\/doc(\d+)\.(png|jpg|jpeg|webp)$/i);
  return m ? parseInt(m[1], 10) : null;
}

(async () => {
  await mongoose.connect(process.env.MONGO_URL);
  const docs = await doctorModel.find({ gender: null }).select('_id image').lean();

  let updated = 0;
  for (const d of docs) {
    const idx = imageIndexFromUrl(d.image || '');
    if (!idx) continue;
    const gender = FEMALE_INDEXES.has(idx) ? 'female' : 'male';
    await doctorModel.updateOne({ _id: d._id }, { $set: { gender } });
    updated++;
  }

  console.log('Backfilled gender for', updated, 'doctors');
  await mongoose.disconnect();
  process.exit(0);
})().catch(async e => { console.error(e); try { await mongoose.disconnect(); } catch {} process.exit(1); });
