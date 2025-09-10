import express from 'express';
import Specialty from '../models/Specialty.js';
const router = express.Router();

// GET /api/specialties  → ["Cardiology", "Neurologist", ...]
router.get('/', async (_req, res) => {
  const items = await Specialty.find({ active: true }).sort({ order: 1, name: 1 }).lean();
  res.json({ success: true, data: items.map(x => x.name) });
});

export default router;
