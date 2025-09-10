import mongoose from 'mongoose';

const SpecialtySchema = new mongoose.Schema({
  name:   { type: String, required: true, unique: true, trim: true },
  order:  { type: Number, default: 999 },
  active: { type: Boolean, default: true },
  icon:   { type: String, default: '' } // optional: URL or key for FE
}, { timestamps: true });

export default mongoose.models.specialty || mongoose.model('specialty', SpecialtySchema);
