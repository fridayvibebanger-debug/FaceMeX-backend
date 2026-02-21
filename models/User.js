import { mongoose } from '../lib/db.js';

const userSchema = new mongoose.Schema(
  {
    // externalId is for users authenticated outside this backend (e.g. Supabase)
    externalId: { type: String, unique: true, sparse: true, index: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: '' },
    name: { type: String, default: '' },
    avatar: { type: String, default: '' },
    coverPhoto: { type: String, default: '' },
    bio: { type: String, default: '' },
    pronouns: { type: String, default: '' },
    mood: { type: String, default: '' },
    location: { type: String, default: '' },
    website: { type: String, default: '' },
    interests: { type: [String], default: [] },
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
