const mongoose = require('mongoose');

const WppSessionSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, unique: true },
  session: { type: Object, default: {} },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WppSession', WppSessionSchema);