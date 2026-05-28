const mongoose = require('mongoose');

const FollowupSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  title: String,
  description: String,
  date: Date,
  status: { type: String, default: 'pending' },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Followup', FollowupSchema);
