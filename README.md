# Intelligent Enterprise Operations Platform (IEOP) - "Akira"

Welcome to **Akira**, an Intelligent Enterprise Operations Platform designed for AI-driven financial document processing and extraction. 

## 🏗️ Architecture: The "Zero-Burn" Stack
This project follows an ultra-efficient, compliance-friendly solo developer architecture.

*   **Frontend**: React 19 + Vite + TypeScript. A minimal, clean UI featuring an AI-powered analytics dashboard with interactive charts (Recharts), document management, and transaction visualization.
*   **Backend**: Nest.js (TypeScript) + TypeORM. A structured REST API handling authentication, document upload, analytics aggregation, and LLM integrations.
*   **Database & Vector Store**: Supabase PostgreSQL with `pgvector`. Storing both relational business data and high-dimensional AI vectors in the exact same database.
*   **File Storage**: Supabase Storage. Bank statement files (PDF, images) are uploaded to a private Supabase Storage bucket.
*   **AI Infrastructure**: Google Gemini 2.5 Flash for transaction extraction and financial insights. Handles both text-based PDFs (via `pdf-parse`) and scanned/image documents (via Gemini Vision multimodal). Supports password-protected PDF decryption. Designed for future RAG with 768-dimensional embeddings via `text-embedding-004`.

## 🗄️ Database Schema Overview
The architecture is designed to simplify DPDP compliance (Right to Erasure) using `CASCADE` deletes across a unified PostgreSQL database.

1.  **Users**: Core authentication and RBAC (`ADMIN` / `USER`).
2.  **Accounts**: Linked bank accounts (e.g., Savings, Credit Card, Loan) belonging to the user.
3.  **Documents**: Bank statement documents pending AI processing.
4.  **Transactions**: Extracted line-item data (Date, Amount, Vendor, Category) tied back to the specific Account and Document.
5.  **Document Chunks**: Raw text splits and mathematical vectors (`vector(768)`) enabling Retrieval-Augmented Generation (RAG) query search.

## 🔑 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register a new user. Body: `{ name, email, password }`. Password must be ≥8 characters. |
| POST | `/auth/login` | Login and receive JWT access token. Body: `{ email, password }`. |

### Accounts (JWT Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/accounts` | List all accounts for the authenticated user |
| GET | `/accounts/:id` | Get a single account by ID |
| POST | `/accounts` | Create a new bank account |
| PATCH | `/accounts/:id` | Update an existing account |
| DELETE | `/accounts/:id` | Delete an account (cascades to documents & transactions) |

### Documents (JWT Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/documents` | List all documents (optional `?accountId=` filter) |
| GET | `/documents/:id` | Get document details with signed download URL |
| POST | `/documents` | Upload a document. Multipart form: `file` (required), `title` (required), `accountId?`, `password?`. Allowed file types: PDF, PNG, JPG, JPEG, CSV. Max 20 MB. `accountId` must belong to the authenticated user. |
| PATCH | `/documents/:id` | Update document metadata |
| DELETE | `/documents/:id` | Delete document + file from storage |

### Transactions (JWT Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/transactions` | List transactions (filters: `accountId`, `type`, `category`, `from`, `to`) |
| GET | `/transactions/:id` | Get a single transaction |
| POST | `/transactions` | Create a new transaction. `accountId` must belong to the authenticated user. |
| PATCH | `/transactions/:id` | Update a transaction |
| DELETE | `/transactions/:id` | Delete a transaction |

### Analytics (JWT Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/analytics/summary` | Aggregated metrics, cashflow trends, top categories, anomalies. Filters: `accountId`, `dateRange` (`1m`, `3m`, `6m`, `1y`, `all`) |
| GET | `/analytics/ai-insights` | AI-generated financial summary, detected subscriptions, and spending anomalies via Gemini. Filters: `accountId`, `dateRange` |

## 🤖 AI Extraction Pipeline
When a document is uploaded with a linked account, the backend automatically:

1. Downloads the file from Supabase Storage
2. If a password was provided, decrypts the PDF using `pdf-parse` (common for Indian bank statements)
3. Extracts text from PDFs using `pdf-parse`
4. If the PDF is scanned (no text), sends the file to **Gemini Vision** (multimodal)
5. Prompts **Gemini 2.5 Flash** to extract structured transaction data (date, amount, type, category, description)
6. Saves extracted transactions to the database linked to the document and account
7. Updates document status: `PENDING` → `PROCESSING` → `COMPLETED` / `FAILED`

The frontend auto-polls for status updates, so users see real-time progress.

## 📊 AI Analytics Dashboard
The dashboard provides a comprehensive financial overview powered by both SQL aggregations and Gemini AI:

*   **Key Metrics**: Total Inflow, Total Outflow, Net Cashflow, Transaction Count
*   **Cashflow Trend Chart**: Interactive area chart showing Income vs. Expenses over time
*   **Top Expense Categories**: Donut chart breaking down spending by category
*   **AI Insights Hero Card**: Gemini analyzes your recent transactions and generates a personalized financial summary
*   **Detected Subscriptions**: AI identifies recurring charges (e.g., Netflix, Spotify)
*   **Anomaly Alerts**: Flags unusually large or out-of-pattern transactions
*   **Time Filtering**: Filter all data by This Month, Past 3 Months, 6 Months, Past Year, or All Time

## 🚀 Getting Started (For Contributors)

To run the full stack locally, you need both the frontend and backend servers running concurrently, along with a connection to a Supabase database.

### 1. Database & Storage Setup
1. You must be added to the Supabase organization for this project, OR you can create your own Supabase project.
2. In Supabase Dashboard → **Storage** → create a private bucket (e.g. `Statements`).
3. Ask the lead developer for the `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.

### 2. Gemini API Key
1. Go to [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create an API key (free tier available, but billing must be enabled for full access)
3. You'll add this to the `.env` file in the next step

### 3. Backend (Nest.js) Setup
```bash
cd backend

# Install dependencies
npm install --legacy-peer-deps

# Setup environment variables
cp .env.example .env

# Edit .env with your database URL, JWT secret, Supabase credentials, and Gemini API key
nano .env 

# Run the development server
npm run start:dev
```

**Required environment variables** (backend validates these at startup and exits with a clear error if any are missing):
- `DATABASE_URL` — Supabase PostgreSQL connection string
- `JWT_SECRET` — Secret for signing JWT tokens
- `GEMINI_API_KEY` — Google Gemini API key
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (for storage access)

**Optional**: `CORS_ORIGINS` (comma-separated, e.g. `http://localhost:5173,http://localhost:3001`), `PORT`, `JWT_EXPIRATION`, `SUPABASE_STORAGE_BUCKET`.

The Nest.js backend runs on `http://localhost:3000`. On the first successful run, TypeORM automatically synchronizes the schema in development. **In production** (`NODE_ENV=production`), schema sync is disabled — use migrations instead.

### 4. Frontend (React + Vite) Setup
```bash
cd frontend

# Install dependencies
npm install

# Run the development server
npm run dev
```

The React frontend runs on `http://localhost:5173`. For **production builds**, set `VITE_API_URL` in `.env` (or `.env.production`) to your backend API URL; otherwise it defaults to `http://localhost:3000`. See `frontend/.env.example`.

### 5. Using the Application
1. Open `http://localhost:5173` in your browser
2. Register a new account on the Register page
3. After login, you'll see the **AI Dashboard** with financial metrics, charts, and AI-generated insights
4. **Accounts** — Add/edit/delete bank accounts
5. **Documents** — Upload bank statements (supports password-protected PDFs) → AI automatically extracts transactions
6. **Transactions** — View AI-extracted + manually added transactions with filtering
7. **Dashboard Filters** — Use the time range dropdown to filter analytics by month, quarter, half-year, or year

## ⚙️ Environment Variables Reference

| File | Purpose |
|------|---------|
| `backend/.env.example` | Backend env template. Copy to `backend/.env` and fill in values. |
| `frontend/.env.example` | Frontend env template. Copy to `frontend/.env` for production builds. |

## 📄 Documentation References
For further reading on the design decisions, data privacy mandates, and business logic, refer to the following original documents inside the root folder:
*   `Execition.docx`: The core architectural blueprint and execution timeline.
*   `IEOP_Product_Blueprint.docx`: Deep-dive product specification.
*   `Product Development and AI Integration.pdf`: Strategic framework and competitive research.