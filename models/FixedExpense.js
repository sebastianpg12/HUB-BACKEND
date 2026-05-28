const mongoose = require('mongoose');

const FixedExpenseSchema = new mongoose.Schema({
	organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
	nombre: { type: String, required: true },
	monto_mensual: { type: Number, required: true },
	activo: { type: Boolean, default: true }
});

module.exports = mongoose.model('FixedExpense', FixedExpenseSchema);
