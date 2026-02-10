import { mongoose } from '../lib/db.js';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    avatar: { type: String, default: '' },
    tier: { type: String, enum: ['free', 'pro', 'creator', 'business', 'exclusive'], default: 'free' },
    addons: {
      verified: { type: Boolean, default: false },
    },
    mode: { type: String, enum: ['social', 'professional'], default: 'social' },
    professional: { type: Object },
  },
  { timestamps: true }
);

export const User = mongoose.models.User || mongoose.model('User', userSchema);
