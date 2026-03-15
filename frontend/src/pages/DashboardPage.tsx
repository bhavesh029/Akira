import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { accountsApi } from '../api/accounts';
import { documentsApi } from '../api/documents';
import { transactionsApi } from '../api/transactions';
import './Dashboard.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const [counts, setCounts] = useState({ accounts: 0, documents: 0, transactions: 0 });

  useEffect(() => {
    Promise.all([
      accountsApi.getAll(),
      documentsApi.getAll(),
      transactionsApi.getAll(),
    ]).then(([a, d, t]) => {
      setCounts({
        accounts: a.data.length,
        documents: d.data.length,
        transactions: t.data.length,
      });
    }).catch(() => {});
  }, []);

  return (
    <div className="dashboard">
      <div className="dashboard-greeting">
        <h2 className="dashboard-title">Welcome back</h2>
        <p className="dashboard-subtitle">
          Signed in as <strong>{user?.email}</strong>
        </p>
      </div>

      <div className="dashboard-grid">
        <Link to="/accounts" className="dashboard-card dashboard-card-link">
          <div className="dashboard-card-icon">🏦</div>
          <div className="dashboard-card-content">
            <h3 className="dashboard-card-title">Accounts</h3>
            <p className="dashboard-card-text">
              Manage your linked bank accounts, credit cards, and loans.
            </p>
            <span className="dashboard-card-count">{counts.accounts} account{counts.accounts !== 1 ? 's' : ''}</span>
          </div>
        </Link>

        <Link to="/documents" className="dashboard-card dashboard-card-link">
          <div className="dashboard-card-icon">📄</div>
          <div className="dashboard-card-content">
            <h3 className="dashboard-card-title">Documents</h3>
            <p className="dashboard-card-text">
              Upload bank statements for AI-powered extraction.
            </p>
            <span className="dashboard-card-count">{counts.documents} document{counts.documents !== 1 ? 's' : ''}</span>
          </div>
        </Link>

        <Link to="/transactions" className="dashboard-card dashboard-card-link">
          <div className="dashboard-card-icon">💳</div>
          <div className="dashboard-card-content">
            <h3 className="dashboard-card-title">Transactions</h3>
            <p className="dashboard-card-text">
              View and categorize extracted spending data.
            </p>
            <span className="dashboard-card-count">{counts.transactions} transaction{counts.transactions !== 1 ? 's' : ''}</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
