const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const FixedExpense = require('../models/FixedExpense');

const orgFilter = (req, extra = {}) => ({ organizationId: req.organizationId, ...extra });
const orgFilterById = (req) => ({ _id: req.params.id, organizationId: req.organizationId });

// ==================== TRANSACCIONES ====================

router.get('/transactions', async (req, res) => {
  try {
    const transactions = await Transaction.find(orgFilter(req))
      .populate('cliente_id', 'nombre apellido email')
      .sort({ fecha: -1 });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/transactions', async (req, res) => {
  try {
    const data = { ...req.body, organizationId: req.organizationId };
    const transaction = new Transaction(data);
    await transaction.save();

    if (transaction.es_recurrente && transaction.tipo === 'ingreso' && transaction.frecuencia) {
      const nextDate = new Date(transaction.fecha);
      if (transaction.frecuencia === 'mensual') nextDate.setMonth(nextDate.getMonth() + 1);
      else if (transaction.frecuencia === 'trimestral') nextDate.setMonth(nextDate.getMonth() + 3);
      else if (transaction.frecuencia === 'semestral') nextDate.setMonth(nextDate.getMonth() + 6);
      else if (transaction.frecuencia === 'anual') nextDate.setFullYear(nextDate.getFullYear() + 1);
      transaction.proximo_pago = nextDate;
      await transaction.save();
    }

    await transaction.populate('cliente_id', 'nombre apellido email');
    res.json(transaction);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/transactions/:id', async (req, res) => {
  try {
    const data = { ...req.body };
    delete data.organizationId;
    const transaction = await Transaction.findOneAndUpdate(orgFilterById(req), data, { new: true })
      .populate('cliente_id', 'nombre apellido email');
    if (!transaction) return res.status(404).json({ error: 'Transacción no encontrada' });
    res.json(transaction);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/transactions/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndDelete(orgFilterById(req));
    if (!transaction) return res.status(404).json({ error: 'Transacción no encontrada' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/transactions/:id/mark-paid', async (req, res) => {
  try {
    const transaction = await Transaction.findOne(orgFilterById(req));
    if (!transaction) return res.status(404).json({ error: 'Transacción no encontrada' });

    transaction.estado_pago = 'pagado';
    transaction.fecha = new Date();

    if (transaction.es_recurrente && transaction.frecuencia) {
      const nextTransaction = new Transaction({
        ...transaction.toObject(),
        _id: undefined,
        organizationId: req.organizationId,
        fecha: transaction.proximo_pago,
        estado_pago: 'pendiente',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const nextDate = new Date(transaction.proximo_pago);
      if (transaction.frecuencia === 'mensual') nextDate.setMonth(nextDate.getMonth() + 1);
      else if (transaction.frecuencia === 'trimestral') nextDate.setMonth(nextDate.getMonth() + 3);
      else if (transaction.frecuencia === 'semestral') nextDate.setMonth(nextDate.getMonth() + 6);
      else if (transaction.frecuencia === 'anual') nextDate.setFullYear(nextDate.getFullYear() + 1);

      nextTransaction.proximo_pago = nextDate;
      await nextTransaction.save();
    }

    await transaction.save();
    await transaction.populate('cliente_id', 'nombre apellido email');
    res.json(transaction);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== GASTOS FIJOS ====================

router.get('/fixed-expenses', async (req, res) => {
  try {
    const expenses = await FixedExpense.find(orgFilter(req)).sort({ createdAt: -1 });
    res.json(expenses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/fixed-expenses', async (req, res) => {
  try {
    const expense = new FixedExpense({ ...req.body, organizationId: req.organizationId });
    await expense.save();
    res.json(expense);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/fixed-expenses/:id', async (req, res) => {
  try {
    const data = { ...req.body };
    delete data.organizationId;
    const expense = await FixedExpense.findOneAndUpdate(orgFilterById(req), data, { new: true });
    if (!expense) return res.status(404).json({ error: 'Gasto fijo no encontrado' });
    res.json(expense);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/fixed-expenses/:id', async (req, res) => {
  try {
    const expense = await FixedExpense.findOneAndDelete(orgFilterById(req));
    if (!expense) return res.status(404).json({ error: 'Gasto fijo no encontrado' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REPORTES Y RESÚMENES ====================

router.get('/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter = { fecha: { $gte: new Date(startDate), $lte: new Date(endDate) } };
    }

    const baseMatch = { organizationId: req.organizationId };

    const ingresos = await Transaction.aggregate([
      { $match: { ...baseMatch, tipo: 'ingreso', ...dateFilter } },
      { $group: { _id: null, total: { $sum: '$monto' } } }
    ]);

    const egresos = await Transaction.aggregate([
      { $match: { ...baseMatch, tipo: 'egreso', ...dateFilter } },
      { $group: { _id: null, total: { $sum: '$monto' } } }
    ]);

    const gastosFijos = await FixedExpense.aggregate([
      { $match: { ...baseMatch, activo: true } },
      { $group: { _id: null, total: { $sum: '$monto_mensual' } } }
    ]);

    const pagosPendientes = await Transaction.find({
      ...baseMatch,
      estado_pago: 'pendiente',
      es_recurrente: true,
      tipo: 'ingreso'
    }).populate('cliente_id', 'nombre apellido');

    const totalIngresos = ingresos.length > 0 ? ingresos[0].total : 0;
    const totalEgresos = egresos.length > 0 ? egresos[0].total : 0;
    const totalGastosFijos = gastosFijos.length > 0 ? gastosFijos[0].total : 0;
    const egresosConGastosFijos = totalEgresos + totalGastosFijos;

    res.json({
      ingresos: totalIngresos,
      egresos: egresosConGastosFijos,
      balance: totalIngresos - egresosConGastosFijos,
      gastos_fijos_mensuales: totalGastosFijos,
      pagos_pendientes: pagosPendientes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/recurring-payments', async (req, res) => {
  try {
    const payments = await Transaction.find({
      organizationId: req.organizationId,
      es_recurrente: true,
      estado_pago: 'pendiente',
      tipo: 'ingreso',
      activo: true
    })
      .populate('cliente_id', 'nombre apellido email telefono')
      .sort({ proximo_pago: 1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
