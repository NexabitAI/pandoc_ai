import 'dotenv/config.js';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import slugify from 'slugify';
import { v2 as cloudinary } from 'cloudinary';
import doctorModel from '../models/doctorModel.js';
import Specialty from '../models/Specialty.js'; // from earlier step

// ----- Cloudinary setup -----
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ----- Constants -----
const FEMALE_INDEXES = new Set([2,5,9,11,13,15]); // doc2,5,9,11,13,15
const IMAGES_DIR = path.resolve(process.cwd(), '../pandoc/src/assets');
const IMAGE_FILES = Array.from({ length: 15 }, (_, i) => `doc${i+1}.png`);
const CLD_FOLDER  = 'hms/doctors';

const FEMALE_FIRST = ['Emily','Sarah','Ava','Zoe','Chloe','Amelia','Sophia','Olivia','Mia','Isabella'];
const MALE_FIRST   = ['Richard','Christopher','Andrew','Timothy','Jeffrey','Patrick','Ryan','Michael','David','Daniel'];
const LAST_NAMES   = ['James','Larson','Patel','Lee','Mitchell','Kelly','Evans','Hill','Garcia','Martinez','King','Harris','White','Williams','Davis','Brown','Johnson','Clark','Lewis','Walker'];

function pick(arr, i) { return arr[i % arr.length]; }

async function uploadAllImages() {
  const out = [];
  for (let i = 0; i < IMAGE_FILES.length; i++) {
    const file = IMAGE_FILES[i];
    const p = path.join(IMAGES_DIR, file);
    if (!fs.existsSync(p)) {
      console.warn('Skipping missing file:', p);
      out.push(null);
      continue;
    }
    const publicId = `${CLD_FOLDER}/${path.parse(file).name}`;
    const res = await cloudinary.uploader.upload(p, {
      folder: CLD_FOLDER,
      public_id: path.parse(file).name,
      use_filename: true,
      unique_filename: false,
      overwrite: true,
      resource_type: 'image'
    });
    out.push(res.secure_url);
    console.log('Uploaded:', file, '→', res.secure_url);
  }
  return out;
}

function makeAbout(name, speciality) {
  return `${name} provides comprehensive care in ${speciality}, focusing on prevention, accurate diagnosis and patient-first treatment plans.`;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

(async () => {
  const url = process.env.MONGO_URL;
  if (!url) throw new Error('Missing MONGO_URL in .env');

  await mongoose.connect(url);

  // 1) Grab specialties from DB
  const specs = await Specialty.find({ active: true }).sort({ order: 1, name: 1 }).lean();
  if (!specs.length) throw new Error('No specialties found. Seed specialties first.');

  // 2) Upload images to Cloudinary, get URLs (re-runnable: overwrite true)
  const imageUrls = await uploadAllImages();
  const validUrls = imageUrls.filter(Boolean);
  if (!validUrls.length) throw new Error('No doctor images uploaded.');

  // 3) Precompute a hashed password
  const rawPassword = 'Doc@12345';
  const hash = await bcrypt.hash(rawPassword, 10);

  // 4) Build bulk ops: 1 doctor per specialty (round-robin images, gendered names by image index)
  const ops = [];
  let imgIdx = 0;

  specs.forEach((s, idx) => {
    // Pick an image (0..14)
    const imageIndex = imgIdx % IMAGE_FILES.length; // 0-based
    const imageFileNum = imageIndex + 1; // 1..15
    const imageUrl = imageUrls[imageIndex] || validUrls[imageIndex % validUrls.length];

    const female = FEMALE_INDEXES.has(imageFileNum);
    const first = female ? pick(FEMALE_FIRST, idx) : pick(MALE_FIRST, idx);
    const last  = pick(LAST_NAMES, idx);

    const name = `Dr. ${first} ${last}`;
    const specSlug = slugify(s.name, { lower: true, strict: true }) || `spec${idx+1}`;
    const email = `${specSlug}@seed.mypandoc.local`; // unique/stable email per specialty

    const experience = `${randInt(1, 12)} Years`;
    const fees       = randInt(30, 120);
    const degree     = ['MBBS','MBBS, MD','MBBS, FCPS','MBBS, MRCP'][idx % 4];

    const address = {
      line1: `${randInt(10,99)}th Cross, Richmond`,
      line2: 'Circle, Ring Road, London'
    };

    const doc = {
      name,
      email,
      password: hash,
      image: imageUrl,
      speciality: s.name,
      degree,
      experience,
      about: makeAbout(name, s.name),
      fees,
      address,
      date: Date.now()
    };

    // Upsert by email to make the script re-runnable safely
    ops.push({
      updateOne: {
        filter: { email },
        update: { $setOnInsert: doc },
        upsert: true
      }
    });

    imgIdx++;
  });

  const res = await doctorModel.bulkWrite(ops, { ordered: false });

  const inserted = res.insertedCount ?? 0;
  const upserted = res.upsertedCount ?? (Array.isArray(res.upsertedIds) ? res.upsertedIds.length : 0);
  const matched  = res.matchedCount ?? 0;
  const modified = res.modifiedCount ?? 0;

  console.log('Bulk doctor seed -> inserted:', inserted, 'upserted:', upserted, 'matched:', matched, 'modified:', modified);

  const count = await doctorModel.countDocuments();
  console.log('Total doctors in DB:', count);

  await mongoose.disconnect();
  console.log('Done.');
})().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
