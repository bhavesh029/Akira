# Intelligent Enterprise Operations Platform (IEOP) - "Akira"

Welcome to **Akira**, an Intelligent Enterprise Operations Platform designed for AI-driven financial document processing and extraction. 

## 🏗️ Architecture: The "Zero-Burn" Stack
This project follows an ultra-efficient, compliance-friendly solo developer architecture.

*   **Frontend**: Next.js 15 (React) + TypeScript + Tailwind CSS. A unified web platform for parsing documents and visualizing extracted bank data.
*   **Backend**: Nest.js (TypeScript) + TypeORM. A structured REST API handling authentication, document upload chunking, and LLM integrations.
*   **Database & Vector Store**: Supabase PostgreSQL with `pgvector`. Storing both relational business data and high-dimensional AI vectors in the exact same database.
*   **AI Infrastructure**: Designed to interface with Gemini API (using 768-dimensional embeddings via `text-embedding-004`).

## 🗄️ Database Schema Overview
The architecture is designed to simplify DPDP compliance (Right to Erasure) using `CASCADE` deletes across a unified PostgreSQL database.

1.  **Users**: Core authentication and RBAC (`ADMIN` / `USER`).
2.  **Accounts**: Linked bank accounts (e.g., Savings, Credit Card, Loan) belonging to the user.
3.  **Documents**: Bank statement documents pending AI processing.
4.  **Transactions**: Extracted line-item data (Date, Amount, Vendor, Category) tied back to the specific Account and Document.
5.  **Document Chunks**: Raw text splits and mathematical vectors (`vector(768)`) enabling Retrieval-Augmented Generation (RAG) query search.

## 🚀 Getting Started (For Contributors)

To run the full stack locally, you need both the frontend and backend servers running concurrently, along with a connection to a Supabase database.

### 1. Database Setup
1. You must be added to the Supabase organization for this project, OR you can create your own Supabase project for local testing.
2. Ask the lead developer for the `DATABASE_URL` connection string.

### 2. Backend (Nest.js) Setup
```bash
cd backend

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env

# Edit .env and paste the `DATABASE_URL` and missing JWT keys
nano .env 

# Run the development server
npm run start:dev
```
The Nest.js backend will run on `http://localhost:3000`. On the first successful run, TypeORM will automatically synchronize the tables in Supabase.

### 3. Frontend (Next.js) Setup
```bash
cd frontend

# Install dependencies
npm install

# Run the development server
npm run dev
```
The Next.js frontend will run on `http://localhost:3001` (if the backend is already using port 3000).

## 📄 Documentation References
For further reading on the design decisions, data privacy mandates, and business logic, refer to the following original documents inside the root folder:
*   `Execition.docx`: The core architectural blueprint and execution timeline.
*   `IEOP_Product_Blueprint.docx`: Deep-dive product specification.
*   `Product Development and AI Integration.pdf`: Strategic framework and competitive research.