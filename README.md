# ⚡ EcoPulse — Full-Stack Fintech Dashboard

**EcoPulse** is a personal finance visualizer that bridges the gap between daily spending and market performance. By pulling real-time purchase data and comparing it against specific sector ETFs (like JETS for travel or XLP for groceries), it generates a unique **ecoPulseScore** to show how your lifestyle aligns with the broader economy.

---

## 🚀 Features

- **Live Transaction Sync:** Integrates with the **Capital One Nessie API** to fetch real-world purchase history.
- **Market Intelligence:** Maps spending categories to Wall Street Tickers (JETS, XLE, XLP, etc.) using the **Alpha Vantage API**.
- **Smart Caching:** Implements a MongoDB-backed caching layer for market data to respect API rate limits (5 calls/min).
- **Realistic Fallbacks:** Includes a built-in "Static Fallback" system to ensure the UI remains functional and looks professional even when API limits are reached.
- **Modern UI:** A responsive React-based dashboard featuring real-time "Pulse" generation and historical data visualization.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (via Babel), CSS3 (Custom Design System) |
| Backend | Node.js, Express.js |
| Database | MongoDB Atlas |
| APIs | Capital One Nessie, Alpha Vantage, Bloomberg (Delayed) |

---

## ⚙️ Installation & Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-username/ecopulse.git
cd ecopulse
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment variables

Create a `.env` file in the root directory and add your credentials:

```env
PORT=5001
MONGODB_URI=your_mongodb_connection_string
NESSIE_API_KEY=your_nessie_key
NESSIE_ACCOUNT_ID=your_nessie_account_id
ALPHA_VANTAGE_KEY=your_alpha_vantage_key
```

### 4. Project structure

Place your `index.html` inside a `public/` folder so Express can serve it:

```
ecopulse/
├── public/
│   └── index.html
├── server.js
├── .env
└── package.json
```

### 5. Start the server

```bash
node server.js
```

The dashboard will be available at **http://localhost:5001**.

---

## 📊 How the "Pulse" Works

When you click **Fetch Pulse**, the system executes the following flow:

1. **Retrieve** — Grabs the latest purchase from your Nessie account.
2. **Categorize** — Uses a custom helper to map the merchant name to a specific market sector.
3. **Analyse** — Fetches the 24-hour price trend for that sector's corresponding ETF.
4. **Score** — Calculates an `ecoPulseScore` based on your spend relative to the market-adjusted benchmark.
5. **Persist** — Saves the enriched record to MongoDB Atlas for history tracking.

---

## 🛡️ License

Distributed under the MIT License. See `LICENSE` for more information.
