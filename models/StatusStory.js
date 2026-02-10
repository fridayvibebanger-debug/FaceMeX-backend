import mongoose from 'mongoose';

const StatusStorySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    userAvatar: { type: String },
    mediaUrl: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video'], required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

StatusStorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const StatusStory = mongoose.models.StatusStory || mongoose.model('StatusStory', StatusStorySchema);

export default StatusStory;
