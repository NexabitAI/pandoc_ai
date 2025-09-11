// ...existing imports...
import mongoose from 'mongoose';

const doctorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  image: { type: String, required: true },
  speciality: { type: String, required: true },
  degree: { type: String, required: true },
  experience: { type: String, required: true }, // e.g., "4 Years"
  fees: { type: Number, required: true },
  address: {
    line1: String,
    line2: String
  },
  available: { type: Boolean, default: true },
  gender: { type: String, enum: ['male', 'female'], default: null }, // ← NEW
  date: { type: Number, required: true }
});

const doctorModel = mongoose.models.doctor || mongoose.model('doctor', doctorSchema);
export default doctorModel;
