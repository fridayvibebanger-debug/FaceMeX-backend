import mongoose from 'mongoose';

const JournalEntrySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, default: '' },
    content: { type: String, default: '' },
    mood: { type: String, default: '' },
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const JournalEntry = mongoose.model('JournalEntry', JournalEntrySchema);
export default JournalEntry;
