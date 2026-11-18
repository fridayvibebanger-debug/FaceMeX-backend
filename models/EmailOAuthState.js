import { mongoose } from '../lib/db.js';

const emailOAuthStateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    stateHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

emailOAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailOAuthState = mongoose.models.EmailOAuthState ||
  mongoose.model('EmailOAuthState', emailOAuthStateSchema);
