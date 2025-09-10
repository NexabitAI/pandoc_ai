import 'dotenv/config.js';
import mongoose from 'mongoose';
import Specialty from '../models/Specialty.js';

const SPECIALTIES = [
  'Family Medicine','Internal Medicine','Hospital Medicine','Geriatric Medicine','Adolescent Medicine',
  'Preventive Medicine','Community Medicine','Lifestyle Medicine','Obesity Medicine',
  'Palliative Care / Hospice Medicine','Emergency Medicine','Critical Care Medicine','Anesthesiology',
  'Cardiology','Pulmonology','Gastroenterologist','Hepatology','Nephrology',
  'Endocrinology, Diabetes & Metabolism','Rheumatology','Infectious Diseases','Hematology',
  'Medical Oncology','Allergy & Immunology','Clinical Pharmacology','Pediatricians','Neonatology',
  'Neurologist','Psychiatry','Obstetrics & Gynecology','General Surgery','Cardiothoracic Surgery',
  'Vascular Surgery','Neurosurgery','Orthopedic Surgery','Otolaryngology (ENT)',
  'Plastic & Reconstructive Surgery','Urology','Ophthalmology','Pediatric Surgery','Transplant Surgery',
  'Surgical Oncology','Breast Surgery','Bariatric & Metabolic Surgery','Colorectal Surgery',
  'Dermatologist','Diagnostic Radiology','Interventional Radiology','Radiation Oncology','Nuclear Medicine',
  'Anatomic Pathology','Clinical Pathology (Laboratory Medicine)','Forensic Pathology',
  'Physical Medicine & Rehabilitation (PM&R)','Sports Medicine','Sleep Medicine','Addiction Medicine',
  'Occupational & Environmental Medicine','Aerospace Medicine','Travel & Tropical Medicine',
  'Medical Genetics & Genomics','Clinical Informatics','Wound Care','Phlebology (Vein Medicine)',
  'Women’s Health','Men’s Health / Andrology','Aesthetic Medicine','Pain Medicine','Hyperbaric Medicine',
  'Medical Toxicology','Wilderness Medicine','Geriatric Psychiatry','Child & Adolescent Psychiatry',
  'Behavioral Neurology & Neuropsychiatry','Neurocritical Care','Endocrine Surgery','Hand Surgery',
  'Foot & Ankle Surgery','Spine Surgery','Geriatric Oncology','Neuromuscular Medicine','Clinical Nutrition',
  // keep exact strings already used by your app so nothing breaks:
  'General physician','Gynecologist','Gastroenterologist','Pediatricians','Neurologist','Dermatologist'
];

(async () => {
  const url = process.env.MONGODB_URI;
  if (!url) throw new Error('Missing MONGO_URL in .env');
  await mongoose.connect(url);

  // upsert by name (idempotent)
  const ops = SPECIALTIES.map((name, i) => ({
    updateOne: {
      filter: { name },
      update: { $setOnInsert: { name, order: i + 1, active: true } },
      upsert: true
    }
  }));

  const res = await Specialty.bulkWrite(ops);
  console.log('Upserted specialties:', res.nUpserted);
  await mongoose.disconnect();
})();
