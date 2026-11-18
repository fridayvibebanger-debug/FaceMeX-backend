import { mongoose } from '../lib/db.js';

const gmailConnectionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    encryptedAccessToken: { type: String, required: true },
    encryptedRefreshToken: { type: String, required: true },
    accessTokenExpiresAt: { type: Date, required: true },
    needsReauth: { type: Boolean, default: false },
    connectedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const GmailConnection = mongoose.models.GmailConnection ||
  mongoose.model('GmailConnection', gmailConnectionSchema);
