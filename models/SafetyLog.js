import mongoose from 'mongoose';

const SafetyLogSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    userId: { type: String, index: true },
    details: { type: Object },
  },
  { timestamps: true }
);

const SafetyLog = mongoose.model('SafetyLog', SafetyLogSchema);
export default SafetyLog;
