const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  tipo: { 
    type: String, 
    required: true, 
    enum: ['ingreso', 'egreso'] 
  },
  concepto: { 
    type: String, 
    required: true 
  },
  monto: { 
    type: Number, 
    required: true 
  },
  fecha: { 
    type: Date, 
    required: true,
    default: Date.now 
  },
  metodo: { 
    type: String,
    enum: ['efectivo', 'transferencia', 'tarjeta_credito', 'tarjeta_debito', 'cheque', 'pse', 'nequi', 'daviplata'],
    default: 'efectivo'
  },
  cliente_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Client',
    required: false 
  },
  // Campos para pagos recurrentes
  es_recurrente: { 
    type: Boolean, 
    default: false 
  },
  frecuencia: {
    type: String,
    enum: ['mensual', 'trimestral', 'semestral', 'anual'],
    required: false
  },
  proximo_pago: {
    type: Date,
    required: false
  },
  activo: {
    type: Boolean,
    default: true
  },
  // Estado del pago (para clientes con pagos mensuales)
  estado_pago: {
    type: String,
    enum: ['pendiente', 'pagado', 'vencido'],
    default: 'pendiente'
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Middleware para actualizar updatedAt
TransactionSchema.pre('save', function() {
  this.updatedAt = Date.now();
});

module.exports = mongoose.model('Transaction', TransactionSchema);
