require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 5001;

// ─── MONGODB ────────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI);
async function connectDB() {
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB Atlas');
  } catch (e) {
    console.error('❌ MongoDB Connection Error:', e.message);
    process.exit(1);
  }
}
connectDB();

function db() { return client.db('EcoPulse'); }

// ─── HELPERS ────────────────────────────────────────────────────────────────
function getCategory(merchantName = '') {
  const n = merchantName.toLowerCase();

  // 1. Fuel & Auto (Energy Sector)
  if (n.match(/shell|exxon|chevron|bp|gas|fuel|arco|mobil/))
    return { category: 'Fuel & Auto', ticker: 'XLE', sector: 'Energy', prefix: 'GAS_FUEL' };

  // 2. Groceries (Consumer Staples)
  if (n.match(/walmart|whole foods|kroger|safeway|trader joe|aldi|grocery|target/))
    return { category: 'Groceries', ticker: 'XLP', sector: 'Consumer Staples', prefix: 'GROC_FOOD' };

  // 3. Travel (Travel & Leisure)
  if (n.match(/delta|united|airline|american|southwest|travel|hotel|airbnb|expedia/))
    return { category: 'Travel', ticker: 'JETS', sector: 'Travel & Leisure', prefix: 'TRVL_AIR' };

  // 4. Streaming & Tech (Communication Services)
  if (n.match(/netflix|hulu|disney|streaming|spotify|apple|google/))
    return { category: 'Streaming', ticker: 'XLC', sector: 'Communication Services', prefix: 'ENT_STRM' };

  // 5. SHOPPING (Consumer Discretionary)
  // This covers everything from Amazon to clothing stores
  if (n.match(/amazon|ebay|etsy|nike|adidas|mall|shop|boutique|retail/))
    return { category: 'Shopping', ticker: 'XLY', sector: 'Consumer Discretionary', prefix: 'RETL_ECOM' };

  // 6. Utilities (Utilities Sector)
  if (n.match(/pg&e|electric|water|utility|bill|comcast|at&t/))
    return { category: 'Utilities', ticker: 'XLU', sector: 'Utilities', prefix: 'UTIL_ELEC' };

  // FALLBACK
  return { category: 'General', ticker: 'SPY', sector: 'Market', prefix: 'GEN_MISC' };
}

function calculateScore(spend, marketPrice) {
  const s = parseFloat(spend);
  const m = parseFloat(marketPrice);
  if (!s || isNaN(m)) return 50;
  const benchmark = 55;
  const expectedSpend = (m / 75) * benchmark;
  const diff = ((expectedSpend - s) / expectedSpend) * 100;
  return Math.min(Math.max(Math.round(70 + diff), 0), 100);
}

function scoreInsight(score) {
  if (score >= 80) return 'Elite Efficiency! Your spending is significantly below the market index.';
  if (score >= 60) return 'Great job! You are successfully beating current inflation trends.';
  if (score >= 40) return 'Caution: Market costs are rising. Consider using your rewards points!';
  return 'Warning: Spending spike detected relative to the Retail Index.';
}

// ─── MARKET DATA (Alpha Vantage + Bloomberg fallback) ────────────────────────
async function fetchMarketData(ticker = 'XLP') {
  // --- 0. HARDCODED JETS FALLBACK (ADD THIS) ---
  if (ticker === 'JETS') {
    console.log("Using hardcoded fallback for JETS to save API limits.");
    return { 
      price: "21.45", 
      changePercent: "+0.12%", 
      source: 'hardcoded-jets' 
    };
  }

  // 1. Try Alpha Vantage
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${process.env.ALPHA_VANTAGE_KEY}`;
    const { data } = await axios.get(url, { timeout: 6000 });
    const q = data['Global Quote'];
    if (q && q['05. price']) {
      return {
        price: q['05. price'],
        changePercent: q['10. change percent'] || '0%',
        source: 'alphavantage',
      };
    }
  } catch (e) {
    console.warn(`Alpha Vantage miss for ${ticker}:`, e.message);
  }

  // 2. Try Bloomberg Market Concepts (BusinessInsider Ajax)
  try {
    const bloombergUrl = `https://markets.businessinsider.com/ajax/SearchController_Suggest?max_results=1&query=${ticker}`;
    const { data } = await axios.get(bloombergUrl, {
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    
    const match = String(data).match(/[\d]+\.[\d]+/);
    if (match) {
      return { price: match[0], changePercent: '0%', source: 'bloomberg-delayed' };
    }
  } catch (e) {
    console.warn(`Bloomberg delayed miss for ${ticker}:`, e.message);
  }

  // 3. Graceful fallback — return realistic prices based on the ticker
  const fallbackPrices = {
    'SPY':  '510.25',
    'JETS': '21.45',
    'XLP':  '72.30',
    'XLE':  '94.10',
    'XLY':  '178.50',
    'XLU':  '64.20',
    'XLC':  '81.15',
    'XRT':  '75.40'
  };

  console.warn(`⚠️  API Limit hit for ${ticker}. Using realistic fallback.`);
  
  return { 
    price: fallbackPrices[ticker] || '75.00', 
    changePercent: '0.00%', 
    source: 'fallback-static' 
  };
}
  // ─── ROUTES ─────────────────────────────────────────────────────────────────

  // GET /get-pulse  — fetch latest Nessie transaction, enrich it, save to Mongo
app.get('/get-pulse', async (req, res) => {
  try {
    const apiKey = process.env.NESSIE_API_KEY;
    const accountId = process.env.NESSIE_ACCOUNT_ID;

    // 1. Fetch from Nessie
    const nessieUrl = `http://api.nessieisreal.com/accounts/${accountId}/purchases?key=${apiKey}`;
    const nessieRes = await axios.get(nessieUrl);
    const purchases = nessieRes.data;

    // 2. Handle Empty Account
    if (!purchases || purchases.length === 0) {
      return res.status(200).json({ 
        ok: true, 
        message: "Account connected! No purchases found yet.",
        pulse: { // Sending a blank pulse object so the frontend doesn't crash
          merchant: "No Data",
          ecoPulseScore: 0,
          insight: "Add a purchase to see your score!"
        }
      });
    }

    // 3. Process Latest Transaction
    const latestPurchase = purchases[purchases.length - 1];
    const meta = getCategory(latestPurchase.description || "Retail"); 
    const marketData = await fetchMarketData(meta.ticker);

    // 4. Construct the Pulse Object
  const newPulse = {
  merchant: latestPurchase.description || "Retail Purchase",
  amount: parseFloat(latestPurchase.amount) || 0,
  category: meta.category || "General",
  sector: meta.sector || "Market",
  ticker: meta.ticker || "SPY",
  
  // Matches the 'price' property from your fetchMarketData function
  marketPrice: marketData.price || "0.00",
  
  // FIX: Matches 'changePercent' from your function (which already has the %)
  marketTrend: marketData.changePercent || "0%",
  
  // Your randomized ecoPulseScore logic
  ecoPulseScore: Math.floor(Math.random() * (95 - 40 + 1)) + 40, 
  
  insight: `Your spending in ${meta.category || 'this category'} aligns with ${meta.ticker || 'market'} movements.`,
  
  // Real Date object for MongoDB sorting/graphs
  created_at: new Date()
};

    console.log("DEBUG: Final Pulse Object ->", newPulse);

    // 5. Save to MongoDB and Send Response
    await db().collection('history').insertOne(newPulse);
    res.json({ ok: true, pulse: newPulse });

  } catch (err) {
    // THIS WAS MISSING: The catch block handles the error if the API fails
    console.error('Pulse Route Error:', err.message);
    res.status(500).json({ ok: false, error: "Failed to sync pulse data." });
  }
});

// GET /get-history  — last N pulses for the chart
app.get('/get-history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const history = await db()
      .collection('history')
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    res.json({ ok: true, data: history });
  } catch (err) {
    console.error('get-history error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/seed-history', async (req, res) => {
  try {
    const col = db().collection('history');
    await col.deleteMany({}); // Wipe old wonky data
    const formatted = req.body.map(tx => ({
      ...tx,
      createdAt: new Date() 
    }));
    await col.insertMany(formatted);
    res.json({ ok: true, message: "Database Cleaned & Seeded!" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /get-dashboard  — aggregated monthly stats + category breakdown
app.get('/get-dashboard', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Use the 'history' collection for everything to keep it consistent
    const col = db().collection('history');

    // 1. Fetch History
    const rawHistory = await col.find().sort({ created_at: -1 }).limit(20).toArray();
    const history = rawHistory.map(p => ({
      ...p,
      merchant_name: p.merchant_name || p.merchant,
      original_category: p.original_category || p.category,
      mapped_sector_etf: p.mapped_sector_etf || p.ticker,
      mapped_sector: p.mapped_sector || p.sector,
      created_at: p.created_at || p.createdAt || p.date
    }));

    // 2. Category Breakdown Aggregation
    const categoryBreakdown = await col.aggregate([
      { $match: { 
          $or: [
            { created_at: { $gte: startOfMonth } },
            { createdAt: { $gte: startOfMonth } }
          ] 
      }},
      {
        $group: {
          _id: '$original_category', 
          ticker: { $first: '$mapped_sector_etf' },
          total: { $sum: '$amount' }, 
          sector: { $first: '$mapped_sector' },
          color: { $first: '$color' }
        }
      },
      { $sort: { total: -1 } }
    ]).toArray();

    const totalAll = categoryBreakdown.reduce((sum, c) => sum + (c.total || 0), 0);

    // 3. Weekly Trend Aggregation (The Graph Data)
    const weeklyTrendData = await col.aggregate([
      { $match: { created_at: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
          dailyTotal: { $sum: "$amount" }
        }
      },
      { $sort: { "_id": 1 } }
    ]).toArray();

    // Map to a simple array of numbers for the frontend Sparkline
    const spendingTrend7d = weeklyTrendData.map(d => d.dailyTotal);

    // 4. ONE SINGLE RESPONSE FOR EVERYTHING
    res.json({
      ok: true,
      data: {
        period: { 
          month: now.toLocaleString('default', { month: 'long' }), 
          year: now.getFullYear() 
        },
        summary: {
          totalSpent: totalAll,
          transactionCount: history.length,
          avgEcoPulseScore: 85 // You can calculate this later
        },
        categoryBreakdown: categoryBreakdown.map(c => ({
          category: c._id || 'Uncategorized',
          sector: c.ticker || 'N/A',
          amount: Math.round(c.total * 100) / 100,
          pct: totalAll > 0 ? Math.round((c.total / totalAll) * 100) : 0,
          color: c.color || '#4af0c8'
        })),
        history: history,
        spendingTrend7d: spendingTrend7d
      }
    });

  } catch (err) {
    console.error('get-dashboard error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
});

// GET /market-quote/:ticker  — on-demand market quote (used by frontend live badge)
app.get('/market-quote/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const market = await fetchMarketData(ticker.toUpperCase());
    res.json({ ok: true, ticker: ticker.toUpperCase(), ...market });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'EcoPulse API running', version: '2.0' }));

// --- PLACE THIS AT THE BOTTOM OF SERVER.JS (BEFORE APP.LISTEN) ---

app.get('/api/market-indices', async (req, res) => {
  try {
    const tickers = ['XLP', 'XLE', 'JETS', 'XLY', 'XLU', 'XLC', 'XRT', 'SPY'];
    const cacheCol = db().collection('market_cache');
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const cachedData = await cacheCol.find({ lastUpdated: { $gt: oneHourAgo } }).toArray();

    // If we have data, send it!
    if (cachedData.length > 0) {
      return res.json({ ok: true, indices: cachedData, isComplete: cachedData.length === tickers.length });
    }

    // If NO data, trigger the fetch in the BACKGROUND and tell the frontend to wait
    res.json({ ok: true, indices: [], message: "Initializing first-time sync..." });

    // Background process (no 'await' on the whole loop so the response sends immediately)
    (async () => {
       for (const ticker of tickers) {
         try {
           const market = await fetchMarketData(ticker);
           await cacheCol.updateOne({ ticker }, { $set: { ticker, ...market, lastUpdated: new Date() } }, { upsert: true });
           await new Promise(r => setTimeout(r, 12000)); // Respect API limits
         } catch (e) { console.error(e); }
       }
    })();

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── START ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 EcoPulse backend running → http://localhost:${PORT}`);
});
