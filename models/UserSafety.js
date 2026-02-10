import mongoose from 'mongoose';

const UserSafetySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    scamFreeCount: { type: Number, default: 0 },
    warningsCount: { type: Number, default: 0 },
    bansCount: { type: Number, default: 0 },
    lastWarningAt: { type: Date },
    lastBanAt: { type: Date },
    devices: [
      {
        fingerprint: String,
        userAgent: String,
        ipCity: String,
        lastSeenAt: Date,
      },
    ],
  },
  { timestamps: true }
);

const UserSafety = mongoose.model('UserSafety', UserSafetySchema);
export default UserSafety;
