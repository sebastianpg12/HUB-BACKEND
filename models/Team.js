const mongoose = require('mongoose');

const TeamSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  name: String,
  role: String,
  email: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Team', TeamSchema);
