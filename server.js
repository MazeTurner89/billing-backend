// ===================================================================================
// FINAL BACKEND CODE
// FILE: server.js (in your 'billing-backend' project)
//
// GOAL: Enhance the /api/bills endpoint to return summary statistics for the
// new Data Explorer page.
// ===================================================================================

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = 8080;

// This should be your MongoDB Atlas connection string.
// For deployment, this will be replaced by process.env.MONGO_URI
const connectionString = process.env.MONGO_URI;
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

app.use(cors());
app.use(express.json());

// --- ROUTES ---

/**
 * @route   GET /api/bills
 * @desc    Get all bills from the database AND summary statistics
 * @access  Public
 */
app.get('/api/bills', async (req, res) => {
  console.log('GET request received for /api/bills');
  try {
    // We run two queries in parallel for efficiency.
    const allBillsPromise = billsCollection.find({}).toArray();
    
    // A new aggregation pipeline to calculate overall statistics.
    const statsPromise = billsCollection.aggregate([
      { $addFields: { costPerUnit: { $divide: ["$totalAmount", "$unitsConsumed"] } } },
      { $group: {
          _id: null,
          totalBills: { $sum: 1 },
          overallAverageCost: { $avg: "$costPerUnit" },
          providerDistribution: { $addToSet: "$provider" } // This is a simple example; a more complex one is below
      }}
    ]).toArray();
    
    // A pipeline to get provider counts for a pie chart
    const providerCountsPromise = billsCollection.aggregate([
        { $group: { _id: "$provider", count: { $sum: 1 } } },
        { $project: { name: "$_id", value: "$count", _id: 0 } }
    ]).toArray();


    // Wait for all promises to resolve.
    const [allBills, stats, providerCounts] = await Promise.all([allBillsPromise, statsPromise, providerCountsPromise]);

    // Combine the results into a single response object.
    res.json({
      bills: allBills,
      summary: stats[0] || { totalBills: 0, overallAverageCost: 0 }, // Provide default values if no bills exist
      providerCounts: providerCounts || []
    });

  } catch (err) {
    console.error("Failed to fetch bills and stats:", err);
    res.status(500).json({ message: "Error fetching data from database." });
  }
});


// The POST /api/bills and GET /api/compare routes are unchanged.
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
    console.error("Analysis failed:", err);
    res.status(500).json({ message: "Error performing analysis." });
  }
});


// --- SERVER ACTIVATION ---
connectToDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`--- Final Backend Server is running on http://localhost:${PORT} ---`);
  });
});