import { mongoose } from '../lib/db.js';

const emailSendSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    payloadHash: { type: String, required: true },
    status: { type: String, enum: ['sending', 'sent', 'failed'], required: true },
    gmailMessageId: { type: String, default: null },
    failureCode: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

emailSendSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
emailSendSchema.index({ userId: 1, payloadHash: 1 }, { unique: true });
emailSendSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailSend = mongoose.models.EmailSend ||
  mongoose.model('EmailSend', emailSendSchema);
