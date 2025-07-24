// ===================================================================================
// FINAL BACKEND CODE (ROBUST VERSION)
// FILE: server.js (in your 'billing-backend' project)
//
// GOAL: Add a check to ensure the MONGO_URI environment variable exists before
// trying to connect to the database. This provides a clear error message on failure.
// ===================================================================================

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = 8080;

// This is the CRITICAL change. We now get the connection string from the
// environment variable provided by the hosting service (Render).
const connectionString = process.env.MONGO_URI;

// NEW: Add a check to ensure the environment variable is set.
if (!connectionString) {
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.error("!!! FATAL ERROR: MONGO_URI environment variable not set. !!!");
  console.error("!!! The server cannot start without a database connection. !!!");
  console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  process.exit(1); // Exit the process with a failure code.
}


const client = new MongoClient(connectionString);
let db, billsCollection;

async function connectToDatabase() {
  try {
    await client.connect();
    db = client.db("billingData");
    billsCollection = db.collection("bills");
    console.log("--- Successfully connected to MongoDB Atlas. ---");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

// Explicitly configure CORS
// TEMPORARY DEBUGGING STEP: Allow requests from ANY origin
const corsOptions = {
  origin: '*',
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

app.use(cors(corsOptions));
app.use(express.json());

// --- ROUTES (Unchanged) ---
app.get('/api/bills', async (req, res) => {
  try {
    const allBillsPromise = billsCollection.find({}).toArray();
    const statsPromise = billsCollection.aggregate([
      { $addFields: { costPerUnit: { $divide: ["$totalAmount", "$unitsConsumed"] } } },
      { $group: {
          _id: null,
          totalBills: { $sum: 1 },
          overallAverageCost: { $avg: "$costPerUnit" }
      }}
    ]).toArray();
    const providerCountsPromise = billsCollection.aggregate([
        { $group: { _id: "$provider", count: { $sum: 1 } } },
        { $project: { name: "$_id", value: "$count", _id: 0 } }
    ]).toArray();
    const [allBills, stats, providerCounts] = await Promise.all([allBillsPromise, statsPromise, providerCountsPromise]);
    res.json({
      bills: allBills,
      summary: stats[0] || { totalBills: 0, overallAverageCost: 0 },
      providerCounts: providerCounts || []
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching data from database." });
  }
});

app.post('/api/bills', async (req, res) => {
  const newBill = req.body;
  if (!newBill.provider || !newBill.totalAmount || !newBill.unitsConsumed) {
    return res.status(400).json({ message: "Missing required fields." });
  }
  try {
    const billToInsert = {
      ...newBill,
      unitsConsumed: Number(newBill.unitsConsumed),
      totalAmount: Number(newBill.totalAmount),
    };
    const result = await billsCollection.insertOne(billToInsert);
    res.status(201).json({
      message: 'Bill data saved successfully.',
      insertedId: result.insertedId,
    });
  } catch (err) {
    res.status(500).json({ message: "Error saving data." });
  }
});

app.get('/api/compare', async (req, res) => {
  const { provider, city, units, amount } = req.query;
  if (!provider || !city || !units || !amount) {
    return res.status(400).json({ message: 'Missing query parameters for comparison.' });
  }
  const userUnits = Number(units);
  const userAmount = Number(amount);
  const userCostPerUnit = userAmount / userUnits;
  try {
    const analysis = await billsCollection.aggregate([
      { $match: { provider: provider, city: city } },
      { $addFields: { costPerUnit: { $divide: ["$totalAmount", "$unitsConsumed"] } } },
      { $group: {
          _id: null,
          averageCostPerUnit: { $avg: "$costPerUnit" },
          minCostPerUnit: { $min: "$costPerUnit" },
          maxCostPerUnit: { $max: "$costPerUnit" },
          count: { $sum: 1 }
      }}
    ]).toArray();
    if (analysis.length === 0) {
      return res.json({
        message: "Not enough data for comparison.",
        userCostPerUnit: userCostPerUnit,
        comparison: null,
      });
    }
    res.json({
      message: "Analysis complete.",
      userCostPerUnit: userCostPerUnit,
      comparison: analysis[0]
    });
  } catch (err) {
    res.status(500).json({ message: "Error performing analysis." });
  }
});

connectToDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`--- Final Backend Server is running on http://localhost:${PORT} ---`);
  });
});
