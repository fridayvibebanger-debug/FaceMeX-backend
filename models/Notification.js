import { mongoose } from '../lib/db.js';

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    fromUserId: { type: String, default: '' },
    type: { type: String, required: true },
    title: { type: String, default: '' },
    message: { type: String, default: '' },
    actionUrl: { type: String, default: '' },
    meta: { type: Object },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
