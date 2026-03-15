# Intelligent Enterprise Operations Platform (IEOP) - "Akira"

Welcome to **Akira**, an Intelligent Enterprise Operations Platform designed for AI-driven financial document processing and extraction. 

## 🏗️ Architecture: The "Zero-Burn" Stack
This project follows an ultra-efficient, compliance-friendly solo developer architecture.

*   **Frontend**: React 19 + Vite + TypeScript. A minimal, clean UI for managing bank accounts, uploading documents, and visualizing extracted data.
*   **Backend**: Nest.js (TypeScript) + TypeORM. A structured REST API handling authentication, document upload, and LLM integrations.
*   **Database & Vector Store**: Supabase PostgreSQL with `pgvector`. Storing both relational business data and high-dimensional AI vectors in the exact same database.
*   **File Storage**: Supabase Storage. Bank statement files (PDF, images) are uploaded to a private Supabase Storage bucket.
*   **AI Infrastructure**: Google Gemini 2.0 Flash for transaction extraction from bank statements. Handles both text-based PDFs (via `pdf-parse`) and scanned/image documents (via Gemini Vision multimodal). Designed for future RAG with 768-dimensional embeddings via `text-embedding-004`.

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
| POST | `/auth/register` | Register a new user (name, email, password) |
| POST | `/auth/login` | Login and receive JWT access token |

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
| POST | `/documents` | Upload a document (multipart form: `file`, `title`, `accountId?`) |
| PATCH | `/documents/:id` | Update document metadata |
| DELETE | `/documents/:id` | Delete document + file from storage |

### Transactions (JWT Protected)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/transactions` | List transactions (filters: `accountId`, `type`, `category`, `from`, `to`) |
| GET | `/transactions/:id` | Get a single transaction |
| POST | `/transactions` | Create a new transaction |
| PATCH | `/transactions/:id` | Update a transaction |
| DELETE | `/transactions/:id` | Delete a transaction |

## 🤖 AI Extraction Pipeline
When a document is uploaded with a linked account, the backend automatically:

1. Downloads the file from Supabase Storage
2. Extracts text from PDFs using `pdf-parse`
3. If the PDF is scanned (no text), sends the file to **Gemini Vision** (multimodal)
4. Prompts **Gemini 2.0 Flash** to extract structured transaction data (date, amount, type, category, description)
5. Saves extracted transactions to the database linked to the document and account
6. Updates document status: `PENDING` → `PROCESSING` → `COMPLETED` / `FAILED`

The frontend auto-polls for status updates, so users see real-time progress.

## 🚀 Getting Started (For Contributors)

To run the full stack locally, you need both the frontend and backend servers running concurrently, along with a connection to a Supabase database.

### 1. Database & Storage Setup
1. You must be added to the Supabase organization for this project, OR you can create your own Supabase project.
2. In Supabase Dashboard → **Storage** → create a private bucket (e.g. `Statements`).
3. Ask the lead developer for the `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.

### 2. Gemini API Key
1. Go to [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Create an API key (free tier available)
3. You'll add this to the `.env` file in the next step

### 2. Backend (Nest.js) Setup
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
The Nest.js backend will run on `http://localhost:3000`. On the first successful run, TypeORM will automatically synchronize the tables in Supabase.

### 3. Frontend (React + Vite) Setup
```bash
cd frontend

# Install dependencies
npm install

# Run the development server
npm run dev
```
The React frontend will run on `http://localhost:5173`.

### 4. Using the Application
1. Open `http://localhost:5173` in your browser
2. Register a new account on the Register page
3. After login, you'll see the Dashboard with live stats
4. **Accounts** — Add/edit/delete bank accounts
5. **Documents** — Upload bank statements → AI automatically extracts transactions
6. **Transactions** — View AI-extracted + manually added transactions with filtering

## 📄 Documentation References
For further reading on the design decisions, data privacy mandates, and business logic, refer to the following original documents inside the root folder:
*   `Execition.docx`: The core architectural blueprint and execution timeline.
*   `IEOP_Product_Blueprint.docx`: Deep-dive product specification.
*   `Product Development and AI Integration.pdf`: Strategic framework and competitive research.