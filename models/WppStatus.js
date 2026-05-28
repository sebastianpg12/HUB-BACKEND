const mongoose = require('mongoose');

const WppStatusSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, unique: true },
  ready: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WppStatus', WppStatusSchema);