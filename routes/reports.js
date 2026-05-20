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

module.exports = router;
