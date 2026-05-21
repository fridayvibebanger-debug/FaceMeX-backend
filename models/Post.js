import { mongoose } from '../lib/db.js';

const commentSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    userId: { type: String, required: true },
    userName: { type: String, default: '' },
    text: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const postSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, default: '' },
    avatar: { type: String, default: '' },

    verified: { type: Boolean, default: false },
    userVerified: { type: Boolean, default: false },

    content: { type: String, default: '' },
    image: { type: String, default: '' },
    images: { type: [String], default: [] },
    audio: { type: String, default: '' },
    mode: {
      type: String,
      enum: ['social', 'professional'],
      default: 'social',
      index: true,
    },
    collabInvites: { type: [String], default: [] },
    collaborators: { type: [String], default: [] },
    likedBy: { type: [String], default: [] },
    comments: { type: [commentSchema], default: [] },
  },
  { timestamps: true }
);

postSchema.index({ createdAt: -1 });

export const Post =
  mongoose.models.Post || mongoose.model('Post', postSchema);
