import mongoose from 'mongoose';

const ScamReportSchema = new mongoose.Schema(
  {
    senderId: { type: String, index: true },
    conversationId: { type: String, index: true },
    content: { type: String, required: true },
    matchedKeyword: { type: String },
    layer: { type: String },
    meta: { type: Object },
  },
  { timestamps: true }
);

const ScamReport = mongoose.model('ScamReport', ScamReportSchema);
export default ScamReport;
