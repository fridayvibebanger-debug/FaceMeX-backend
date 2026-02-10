import mongoose from 'mongoose';

const IdentityVerificationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    imageUrl: { type: String, required: true },
    documentType: { type: String, default: 'id' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    aiResult: { type: Object },
  },
  { timestamps: true }
);

const IdentityVerification = mongoose.model('IdentityVerification', IdentityVerificationSchema);
export default IdentityVerification;
