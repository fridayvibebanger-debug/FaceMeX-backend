import mongoose from 'mongoose';

const StoryStepSchema = new mongoose.Schema(
  {
    userId: { type: String, required: false },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const StoryRoomSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    createdBy: { type: String, required: false },
    steps: { type: [StoryStepSchema], default: [] },
  },
  { timestamps: true }
);

const StoryRoom = mongoose.model('StoryRoom', StoryRoomSchema);
export default StoryRoom;
