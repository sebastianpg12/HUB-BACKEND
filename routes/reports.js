const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const FixedExpense = require('../models/FixedExpense');
const Client = require('../models/Client');
const Activity = require('../models/Activity');
const Case = require('../models/Case');
const Team = require('../models/Team');
const User = require('../models/User');

// Helper to build activity filters based on query params
const buildActivityMatch = async (query) => {
  const match = {};
  
  if (query.clientId) {
    match.clientId = new mongoose.Types.ObjectId(query.clientId);
  }
  
  if (query.assignedTo) {
    match.assignedTo = new mongoose.Types.ObjectId(query.assignedTo);
  }
  
  if (query.department) {
    // Find users in this department
    const usersInDept = await User.find({ department: query.department }).select('_id');
    const userIds = usersInDept.map(u => u._id);
    match.assignedTo = { $in: userIds };
  }
  
  if (query.period) {
    const currentDate = new Date();
    let startDate;
    if (query.period === 'year') {
      startDate = new Date(currentDate.getFullYear(), 0, 1);
    } else if (query.period === 'quarter') {
      const quarter = Math.floor(currentDate.getMonth() / 3);
      startDate = new Date(currentDate.getFullYear(), quarter * 3, 1);
    } else {
      startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    }
    match.createdAt = { $gte: startDate };
  }

  return match;
};

const mongoose = require('mongoose');

// Dashboard general stats
router.get('/dashboard', async (req, res) => {
  try {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const firstDayOfYear = new Date(currentYear, 0, 1);

    // Stats básicas
    const totalClients = await Client.countDocuments();
    const totalActivities = await Activity.countDocuments();
    const totalCases = await Case.countDocuments();
    const totalTeamMembers = await Team.countDocuments();

    // Stats del mes actual
    const monthlyStats = {
      newClients: await Client.countDocuments({ createdAt: { $gte: firstDayOfMonth } }),
      completedActivities: await Activity.countDocuments({ 
        status: 'completed',
        updatedAt: { $gte: firstDayOfMonth }
      }),
      newCases: await Case.countDocuments({ fechaCreacion: { $gte: firstDayOfMonth } }),
      monthlyRevenue: 0,
      monthlyExpenses: 0
    };

    // Ingresos y gastos del mes
    const monthlyTransactions = await Transaction.find({
      fecha: { $gte: firstDayOfMonth }
    });

    monthlyStats.monthlyRevenue = monthlyTransactions
      .filter(t => t.tipo === 'ingreso')
      .reduce((sum, t) => sum + t.monto, 0);

    monthlyStats.monthlyExpenses = monthlyTransactions
      .filter(t => t.tipo === 'egreso')
      .reduce((sum, t) => sum + t.monto, 0);

    res.json({
      success: true,
      data: {
        totals: {
          clients: totalClients,
          activities: totalActivities,
          cases: totalCases,
          teamMembers: totalTeamMembers
        },
        monthly: monthlyStats
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Estadísticas financieras por período
router.get('/financial/:period', async (req, res) => {
  try {
    const { period } = req.params; // 'month', 'quarter', 'year'
    const currentDate = new Date();
    
    let startDate, endDate, groupBy;
    
    switch (period) {
      case 'year':
        startDate = new Date(currentDate.getFullYear(), 0, 1);
        endDate = new Date(currentDate.getFullYear() + 1, 0, 1);
        groupBy = { 
          year: { $year: "$fecha" }, 
          month: { $month: "$fecha" } 
        };
        break;
      case 'quarter':
        const quarter = Math.floor(currentDate.getMonth() / 3);
        startDate = new Date(currentDate.getFullYear(), quarter * 3, 1);
        endDate = new Date(currentDate.getFullYear(), (quarter + 1) * 3, 1);
        groupBy = { 
          year: { $year: "$fecha" }, 
          month: { $month: "$fecha" } 
        };
        break;
      default: // month
        startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
        groupBy = { 
          year: { $year: "$fecha" }, 
          month: { $month: "$fecha" }, 
          day: { $dayOfMonth: "$fecha" } 
        };
    }

    const financialData = await Transaction.aggregate([
      {
        $match: {
          fecha: { $gte: startDate, $lt: endDate }
        }
      },
      {
        $group: {
          _id: {
            ...groupBy,
            tipo: "$tipo"
          },
          total: { $sum: "$monto" },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 }
      }
    ]);

    // Gastos fijos del período
    const fixedExpenses = await FixedExpense.find({ activo: true });
    const totalFixedExpenses = fixedExpenses.reduce((sum, expense) => sum + expense.monto, 0);

    res.json({
      success: true,
      data: {
        transactions: financialData,
        fixedExpenses: totalFixedExpenses,
        period: period,
        startDate,
        endDate
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Estadísticas de actividades
router.get('/activities/stats', async (req, res) => {
  try {
    const match = await buildActivityMatch(req.query);
    const currentDate = new Date();
    const currentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const last3Months = new Date(currentDate.getFullYear(), currentDate.getMonth() - 3, 1);

    // Estadísticas por estado
    const statusStats = await Activity.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);

    // Actividades completadas por mes (últimos 6 meses)
    const completedMatch = { ...match, status: 'completed' };
    delete completedMatch.createdAt; // Para ver la historia sin restringir la creación al periodo actual
    completedMatch.updatedAt = { $gte: new Date(currentDate.getFullYear(), currentDate.getMonth() - 5, 1) };
    
    const completedByMonth = await Activity.aggregate([
      { $match: completedMatch },
      {
        $group: {
          _id: {
            year: { $year: "$updatedAt" },
            month: { $month: "$updatedAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    // Productividad del equipo (actividades completadas por cliente)
    const productivityMatch = { ...match, status: 'completed' };
    delete productivityMatch.createdAt;
    productivityMatch.updatedAt = { $gte: last3Months };

    const productivityByClient = await Activity.aggregate([
      { $match: productivityMatch },
      {
        $lookup: {
          from: 'clients',
          localField: 'clientId',
          foreignField: '_id',
          as: 'client'
        }
      },
      { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$client.name",
          completedActivities: { $sum: 1 }
        }
      },
      { $sort: { completedActivities: -1 } },
      { $limit: 10 }
    ]);

    // Tiempo promedio de resolución
    const resolutionMatch = { ...match, status: 'completed' };

    const resolutionTimeStats = await Activity.aggregate([
      { $match: resolutionMatch },
      {
        $project: {
          resolutionDays: {
            $divide: [
              { $subtract: ["$updatedAt", "$createdAt"] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgResolutionTime: { $avg: "$resolutionDays" },
          minResolutionTime: { $min: "$resolutionDays" },
          maxResolutionTime: { $max: "$resolutionDays" }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        statusDistribution: statusStats,
        completedByMonth,
        productivityByClient,
        resolutionTime: resolutionTimeStats[0] || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Estadísticas de clientes
router.get('/clients/stats', async (req, res) => {
  try {
    const match = await buildActivityMatch(req.query);
    const currentDate = new Date();
    const last6Months = new Date(currentDate.getFullYear(), currentDate.getMonth() - 6, 1);

    // Crecimiento de clientes por mes
    const clientGrowth = await Client.aggregate([
      {
        $match: {
          createdAt: { $gte: last6Months }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          newClients: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    // Clientes más activos (con más actividades filtradas)
    const topActiveClients = await Activity.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'clients',
          localField: 'clientId',
          foreignField: '_id',
          as: 'client'
        }
      },
      { $unwind: { path: "$client", preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: "$client._id",
          clientName: { $first: "$client.name" },
          clientEmail: { $first: "$client.email" },
          totalActivities: { $sum: 1 },
          completedActivities: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
          }
        }
      },
      {
        $addFields: {
          completionRate: {
            $cond: [
              { $gt: ["$totalActivities", 0] },
              { $divide: ["$completedActivities", "$totalActivities"] },
              0
            ]
          }
        }
      },
      { $sort: { totalActivities: -1 } },
      { $limit: 10 }
    ]);

    res.json({
      success: true,
      data: {
        growth: clientGrowth,
        topActive: topActiveClients,
        locationDistribution: []
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Estadísticas del equipo
router.get('/team/performance', async (req, res) => {
  try {
    const match = await buildActivityMatch(req.query);

    const teamPerformance = await Activity.aggregate([
      {
        $match: {
          ...match,
          assignedTo: { $exists: true, $ne: [] }
        }
      },
      {
        $unwind: "$assignedTo"
      },
      {
        // Convertir assignedTo a ObjectId si es string para asegurar el lookup
        $addFields: {
          assignedToObj: {
            $convert: {
              input: "$assignedTo",
              to: "objectId",
              onError: "$assignedTo", // Si falla, mantener el original (evita crash)
              onNull: null
            }
          }
        }
      },
      {
        $group: {
          _id: "$assignedToObj",
          totalActivities: { $sum: 1 },
          completedActivities: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] }
          },
          pendingActivities: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'teamMember'
        }
      },
      {
        $unwind: { path: "$teamMember", preserveNullAndEmptyArrays: true }
      },
      {
        $addFields: {
          completionRate: {
            $cond: [
              { $gt: ["$totalActivities", 0] },
              { $multiply: [{ $divide: ["$completedActivities", "$totalActivities"] }, 100] },
              0
            ]
          }
        }
      },
      {
        $sort: { completionRate: -1 }
      }
    ]);

    // Carga de trabajo actual
    const workload = await Activity.aggregate([
      {
        $match: {
          ...match,
          status: { $in: ['pending', 'in-progress'] },
          assignedTo: { $exists: true, $ne: [] }
        }
      },
      {
        $unwind: "$assignedTo"
      },
      {
        $addFields: {
          assignedToObj: {
            $convert: {
              input: "$assignedTo",
              to: "objectId",
              onError: "$assignedTo",
              onNull: null
            }
          }
        }
      },
      {
        $group: {
          _id: "$assignedToObj",
          activeWorkload: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'teamMember'
        }
      },
      {
        $unwind: { path: "$teamMember", preserveNullAndEmptyArrays: true }
      },
      {
        $sort: { activeWorkload: -1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        performance: teamPerformance,
        currentWorkload: workload
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Resumen ejecutivo
router.get('/executive-summary', async (req, res) => {
  try {
    const match = await buildActivityMatch(req.query);
    const currentDate = new Date();
    const currentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const lastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    const currentYear = new Date(currentDate.getFullYear(), 0, 1);

    // KPIs principales
    const kpis = {
      // Clientes
      totalClients: await Client.countDocuments(match.clientId ? { _id: match.clientId } : {}),
      newClientsThisMonth: await Client.countDocuments({ 
        createdAt: { $gte: currentMonth },
        ...(match.clientId ? { _id: match.clientId } : {})
      }),
      newClientsLastMonth: await Client.countDocuments({ 
        createdAt: { $gte: lastMonth, $lt: currentMonth },
        ...(match.clientId ? { _id: match.clientId } : {})
      }),

      // Actividades
      totalActivities: await Activity.countDocuments(match),
      completedThisMonth: await Activity.countDocuments({
        ...match,
        status: 'completed',
        updatedAt: { $gte: currentMonth }
      }),
      completedLastMonth: await Activity.countDocuments({
        ...match,
        status: 'completed',
        updatedAt: { $gte: lastMonth, $lt: currentMonth }
      }),

      // Financiero
      revenueThisYear: 0,
      revenueThisMonth: 0,
      revenueLastMonth: 0,
      expensesThisMonth: 0
    };

    // Cálculos financieros
    const yearlyRevenue = await Transaction.find({
      tipo: 'ingreso',
      fecha: { $gte: currentYear }
    });
    kpis.revenueThisYear = yearlyRevenue.reduce((sum, t) => sum + t.monto, 0);

    const monthlyRevenue = await Transaction.find({
      tipo: 'ingreso',
      fecha: { $gte: currentMonth }
    });
    kpis.revenueThisMonth = monthlyRevenue.reduce((sum, t) => sum + t.monto, 0);

    const lastMonthRevenue = await Transaction.find({
      tipo: 'ingreso',
      fecha: { $gte: lastMonth, $lt: currentMonth }
    });
    kpis.revenueLastMonth = lastMonthRevenue.reduce((sum, t) => sum + t.monto, 0);

    const monthlyExpenses = await Transaction.find({
      tipo: 'egreso',
      fecha: { $gte: currentMonth }
    });
    kpis.expensesThisMonth = monthlyExpenses.reduce((sum, t) => sum + t.monto, 0);

    // Calcular porcentajes de crecimiento
    const growth = {
      clients: kpis.newClientsLastMonth > 0 ? 
        ((kpis.newClientsThisMonth - kpis.newClientsLastMonth) / kpis.newClientsLastMonth * 100) : 0,
      activities: kpis.completedLastMonth > 0 ? 
        ((kpis.completedThisMonth - kpis.completedLastMonth) / kpis.completedLastMonth * 100) : 0,
      revenue: kpis.revenueLastMonth > 0 ? 
        ((kpis.revenueThisMonth - kpis.revenueLastMonth) / kpis.revenueLastMonth * 100) : 0
    };

    res.json({
      success: true,
      data: {
        kpis,
        growth,
        period: {
          current: currentMonth,
          previous: lastMonth
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KPIs por persona y tendencias (Dashboard v2)
// ═══════════════════════════════════════════════════════════════════════════

const {
  getTeamKPIs,
  getWeeklyTrends,
  getMonthlyTrends,
  generateTeamSummary,
  sendTeamReport,
} = require('../services/teamReportService');

// GET /api/reports/kpis?period=month&department=...
router.get('/kpis', async (req, res) => {
  try {
    const { period, department } = req.query;
    const data = await getTeamKPIs({ period, department });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching KPIs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/reports/trends/weekly?department=...
router.get('/trends/weekly', async (req, res) => {
  try {
    const data = await getWeeklyTrends({ department: req.query.department });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/reports/trends/monthly?department=...
router.get('/trends/monthly', async (req, res) => {
  try {
    const data = await getMonthlyTrends({ department: req.query.department });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/reports/team-summary?period=week&department=...
router.get('/team-summary', async (req, res) => {
  try {
    const { period, department } = req.query;
    const data = await generateTeamSummary({ period, department });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/reports/send-team-report (ejecución manual)
router.post('/send-team-report', async (req, res) => {
  try {
    const { recipients, period, department } = req.body;
    const result = await sendTeamReport({ recipients, period, department });
    res.json(result);
  } catch (error) {
    console.error('Error sending team report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Configuración de reportes programados
// ═══════════════════════════════════════════════════════════════════════════

const Setting = require('../models/Setting');

// GET /api/reports/schedule-config
router.get('/schedule-config', async (req, res) => {
  try {
    let settings = await Setting.findOne({ key: 'teamReports' });
    if (!settings) {
      settings = new Setting({
        key: 'teamReports',
        value: {
          enabled: false,
          frequency: 'weekly',       // weekly | daily | monthly
          dayOfWeek: 1,              // 0=dom, 1=lun ... (para weekly)
          hour: 8,                   // hora Colombia
          minute: 0,
          period: 'week',            // período de datos del reporte
          recipients: [],
          department: null,
          lastRun: null,
        },
      });
      await settings.save();
    }
    res.json({ success: true, data: settings.value });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/reports/schedule-config
router.put('/schedule-config', async (req, res) => {
  try {
    let settings = await Setting.findOne({ key: 'teamReports' });
    if (!settings) {
      settings = new Setting({ key: 'teamReports', value: {} });
    }
    const allowed = ['enabled', 'frequency', 'dayOfWeek', 'hour', 'minute', 'period', 'recipients', 'department'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        settings.value[key] = req.body[key];
      }
    }
    settings.markModified('value');
    await settings.save();
    res.json({ success: true, data: settings.value });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// /overview — endpoint unificado para el dashboard de reportes
// ═══════════════════════════════════════════════════════════════════════════
// Devuelve TODO el dataset necesario para las 4 vistas (resumen, operaciones,
// comercial, equipo) en una sola llamada, con comparación vs período anterior.
//
// Query params:
//   period:     'week' | 'month' | 'quarter' | 'year' | 'custom'  (default: 'month')
//   from, to:   ISO dates si period='custom'
//   department: string (opcional)
//   ownerId:    ObjectId (opcional)
//   clientId:   ObjectId (opcional)
// ═══════════════════════════════════════════════════════════════════════════
const Ticket = require('../models/Ticket');
const Membership = require('../models/Membership');
const ProspectConversation = require('../models/ProspectConversation');

router.get('/overview', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { period = 'month', from, to, department, ownerId, clientId } = req.query;

    // ── Rango actual + anterior (para deltas) ─────────────────────────
    const now = new Date();
    let curStart, curEnd, prevStart, prevEnd;
    if (period === 'custom' && from && to) {
      curStart = new Date(from); curEnd = new Date(to);
      const span = curEnd - curStart;
      prevEnd = new Date(curStart - 1);
      prevStart = new Date(prevEnd - span);
    } else if (period === 'week') {
      curStart = new Date(now); curStart.setDate(now.getDate() - 7); curStart.setHours(0,0,0,0);
      curEnd = now;
      prevEnd = new Date(curStart); prevStart = new Date(curStart); prevStart.setDate(curStart.getDate() - 7);
    } else if (period === 'quarter') {
      curStart = new Date(now); curStart.setMonth(now.getMonth() - 3);
      curEnd = now;
      prevEnd = new Date(curStart); prevStart = new Date(curStart); prevStart.setMonth(curStart.getMonth() - 3);
    } else if (period === 'year') {
      curStart = new Date(now); curStart.setFullYear(now.getFullYear() - 1);
      curEnd = now;
      prevEnd = new Date(curStart); prevStart = new Date(curStart); prevStart.setFullYear(curStart.getFullYear() - 1);
    } else { // month
      curStart = new Date(now); curStart.setMonth(now.getMonth() - 1);
      curEnd = now;
      prevEnd = new Date(curStart); prevStart = new Date(curStart); prevStart.setMonth(curStart.getMonth() - 1);
    }

    // ── Resolver ownerIds si vino department ──────────────────────────
    let ownerIdsInDept = null;
    if (department) {
      const ms = await Membership.find({ organization: orgId, department, status: 'active' }).select('user').lean();
      ownerIdsInDept = ms.map(m => m.user);
    }

    const ownerFilter = (field) => {
      if (ownerId) return { [field]: new mongoose.Types.ObjectId(ownerId) };
      if (ownerIdsInDept) return { [field]: { $in: ownerIdsInDept } };
      return {};
    };

    const baseFilter = { organizationId: orgId };
    if (clientId) baseFilter.clientId = new mongoose.Types.ObjectId(clientId);

    const inRange = (start, end) => ({ createdAt: { $gte: start, $lte: end } });
    const pct = (cur, prev) => prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10;

    // ── ACTIVIDADES ───────────────────────────────────────────────────
    const actMatch = { ...baseFilter, ...ownerFilter('assignedTo') };
    const [actCurAgg, actPrevAgg, actByStatus, actOverdue, actByOwner] = await Promise.all([
      Activity.aggregate([
        { $match: { ...actMatch, ...inRange(curStart, curEnd) } },
        { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } }
      ]),
      Activity.aggregate([
        { $match: { ...actMatch, ...inRange(prevStart, prevEnd) } },
        { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } }
      ]),
      Activity.aggregate([
        { $match: actMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Activity.find({ ...actMatch, status: { $nin: ['completed', 'cancelled'] }, dueDate: { $lt: now } })
        .select('title dueDate priority assignedTo clientId').limit(20)
        .populate('assignedTo', 'name email')
        .populate('clientId', 'name')
        .lean(),
      Activity.aggregate([
        { $match: { ...actMatch, ...inRange(curStart, curEnd) } },
        { $unwind: { path: '$assignedTo', preserveNullAndEmptyArrays: true } },
        { $group: {
          _id: '$assignedTo',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', now] }, { $ne: ['$status', 'completed'] }] }, 1, 0] } }
        } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $project: { _id: 1, name: '$user.name', email: '$user.email', total: 1, completed: 1, overdue: 1 } },
        { $sort: { total: -1 } },
        { $limit: 15 }
      ])
    ]);
    const actCur = actCurAgg[0] || { total: 0, completed: 0 };
    const actPrev = actPrevAgg[0] || { total: 0, completed: 0 };

    // ── TICKETS ───────────────────────────────────────────────────────
    const tkMatch = { ...baseFilter, ...ownerFilter('assignedTo') };
    const [tkCurAgg, tkPrevAgg, tkByStatus, tkOpen, tkBySla] = await Promise.all([
      Ticket.aggregate([
        { $match: { ...tkMatch, ...inRange(curStart, curEnd) } },
        { $group: { _id: null, total: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } } } }
      ]),
      Ticket.aggregate([
        { $match: { ...tkMatch, ...inRange(prevStart, prevEnd) } },
        { $group: { _id: null, total: { $sum: 1 }, resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } } } }
      ]),
      Ticket.aggregate([
        { $match: tkMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Ticket.find({ ...tkMatch, status: { $nin: ['resolved', 'closed'] } })
        .select('ticketNumber subject priority status submittedBy createdAt assignedTo')
        .sort({ createdAt: -1 }).limit(15)
        .populate('assignedTo', 'name email').lean(),
      Ticket.aggregate([
        { $match: { ...tkMatch, ...inRange(curStart, curEnd) } },
        { $project: {
          isOverdue: { $and: [
            { $in: ['$status', ['new', 'open']] },
            { $lt: ['$createdAt', new Date(now - 2 * 60 * 60 * 1000)] }
          ] }
        } },
        { $group: { _id: null, total: { $sum: 1 }, overdue: { $sum: { $cond: ['$isOverdue', 1, 0] } } } }
      ])
    ]);
    const tkCur = tkCurAgg[0] || { total: 0, resolved: 0 };
    const tkPrev = tkPrevAgg[0] || { total: 0, resolved: 0 };
    const tkSla = tkBySla[0] || { total: 0, overdue: 0 };

    // ── CASOS ─────────────────────────────────────────────────────────
    const [casesByStatus, casesOpen] = await Promise.all([
      Case.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$estado', count: { $sum: 1 } } }
      ]),
      Case.find({ ...baseFilter, estado: { $in: ['abierto', 'en_progreso'] } })
        .select('titulo tipo prioridad estado progreso cliente_id createdAt').limit(10)
        .populate('cliente_id', 'name').lean()
    ]);

    // ── PROSPECTOS (pipeline) ─────────────────────────────────────────
    const prospMatch = { ...baseFilter, ...ownerFilter('ownerId') };
    const [prospByStatus, prospCurAgg, prospPrevAgg] = await Promise.all([
      ProspectConversation.aggregate([
        { $match: prospMatch },
        { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$estimatedValue' } } }
      ]),
      ProspectConversation.aggregate([
        { $match: { ...prospMatch, ...inRange(curStart, curEnd) } },
        { $group: { _id: null, total: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'ganado'] }, 1, 0] } }, value: { $sum: '$estimatedValue' } } }
      ]),
      ProspectConversation.aggregate([
        { $match: { ...prospMatch, ...inRange(prevStart, prevEnd) } },
        { $group: { _id: null, total: { $sum: 1 }, won: { $sum: { $cond: [{ $eq: ['$status', 'ganado'] }, 1, 0] } }, value: { $sum: '$estimatedValue' } } }
      ])
    ]);
    const prospCur = prospCurAgg[0] || { total: 0, won: 0, value: 0 };
    const prospPrev = prospPrevAgg[0] || { total: 0, won: 0, value: 0 };

    // Forecast ponderado: suma de estimatedValue * probabilidad por status
    const PROBABILITY = { nuevo: 10, calificado: 30, propuesta: 60, seguimiento: 75, ganado: 100, perdido: 0 };
    let forecast = 0, pipelineValue = 0;
    prospByStatus.forEach(s => {
      pipelineValue += s.value || 0;
      forecast += (s.value || 0) * (PROBABILITY[s._id] || 0) / 100;
    });

    // ── CLIENTES ──────────────────────────────────────────────────────
    const Client = require('../models/Client');
    const [totalClients, newClientsCur, newClientsPrev, atRiskClients] = await Promise.all([
      Client.countDocuments(baseFilter),
      Client.countDocuments({ ...baseFilter, ...inRange(curStart, curEnd) }),
      Client.countDocuments({ ...baseFilter, ...inRange(prevStart, prevEnd) }),
      // "At risk" = no actividad en últimos 30 días
      Client.aggregate([
        { $match: baseFilter },
        { $lookup: {
          from: 'activities',
          let: { cid: '$_id' },
          pipeline: [
            { $match: {
              $expr: { $and: [
                { $eq: ['$clientId', '$$cid'] },
                { $eq: ['$organizationId', orgId] },
                { $gte: ['$createdAt', new Date(now - 30 * 24 * 60 * 60 * 1000)] }
              ] }
            } }
          ],
          as: 'recent'
        } },
        { $match: { recent: { $size: 0 } } },
        { $project: { name: 1, email: 1, company: 1, createdAt: 1 } },
        { $limit: 10 }
      ])
    ]);

    // ── EQUIPO (memberships activos) ──────────────────────────────────
    const teamSize = await Membership.countDocuments({ organization: orgId, status: 'active' });

    // ── Serie temporal: actividades creadas por semana en el rango actual ─
    const weeklyActivity = await Activity.aggregate([
      { $match: { ...actMatch, ...inRange(curStart, curEnd) } },
      { $group: {
        _id: { $dateTrunc: { date: '$createdAt', unit: 'week' } },
        created: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
      } },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        meta: { period, from: curStart, to: curEnd, prevFrom: prevStart, prevTo: prevEnd, generatedAt: new Date() },

        executive: {
          activitiesCompleted: actCur.completed,
          activitiesDelta:     pct(actCur.completed, actPrev.completed),
          ticketsResolved:     tkCur.resolved,
          ticketsDelta:        pct(tkCur.resolved, tkPrev.resolved),
          prospectsValue:      pipelineValue,
          forecast,
          forecastDelta:       pct(prospCur.value, prospPrev.value),
          newClients:          newClientsCur,
          clientsDelta:        pct(newClientsCur, newClientsPrev),
          teamSize,
          atRiskClientCount:   atRiskClients.length,
          overdueActivityCount: actOverdue.length,
          slaBreachCount:       tkSla.overdue
        },

        operations: {
          activitiesByStatus: actByStatus.reduce((m, s) => ({ ...m, [s._id || 'unknown']: s.count }), {}),
          activitiesOverdue:  actOverdue,
          ticketsByStatus:    tkByStatus.reduce((m, s) => ({ ...m, [s._id]: s.count }), {}),
          ticketsOpen:        tkOpen,
          casesByStatus:      casesByStatus.reduce((m, s) => ({ ...m, [s._id]: s.count }), {}),
          casesOpen,
          slaBreach: { total: tkSla.total, overdue: tkSla.overdue }
        },

        commercial: {
          pipelineByStatus: prospByStatus.map(s => ({ status: s._id, count: s.count, value: s.value || 0 })),
          pipelineValue,
          forecast,
          conversionRate: prospCur.total > 0 ? Math.round((prospCur.won / prospCur.total) * 1000) / 10 : 0,
          totalProspects: prospCur.total
        },

        team: {
          byOwner: actByOwner,
          totalMembers: teamSize
        },

        timeseries: {
          weeklyActivity: weeklyActivity.map(w => ({ week: w._id, created: w.created, completed: w.completed }))
        },

        atRiskClients
      }
    });
  } catch (error) {
    console.error('[reports/overview]', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
