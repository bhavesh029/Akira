import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="dashboard">
      <div className="dashboard-greeting">
        <h2 className="dashboard-title">Welcome back</h2>
        <p className="dashboard-subtitle">
          Signed in as <strong>{user?.email}</strong>
        </p>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-card">
          <div className="dashboard-card-icon">🏦</div>
          <div className="dashboard-card-content">
            <h3 className="dashboard-card-title">Accounts</h3>
            <p className="dashboard-card-text">
              Manage your linked bank accounts, credit cards, and loans.
            </p>
          </div>
        </div>

        <div className="dashboard-card dashboard-card-muted">
          <div className="dashboard-card-icon">📄</div>
          <div className="dashboard-card-content">
            <h3 className="dashboard-card-title">Documents</h3>
            <p className="dashboard-card-text">
              Upload bank statements for AI-powered extraction.
            </p>
            <span className="badge badge-neutral">Coming Soon</span>
          </div>
        </div>

        <div className="dashboard-card dashboard-card-muted">
          <div className="dashboard-card-icon">💳</div>
          <div className="dashboard-card-content">
            <h3 className="dashboard-card-title">Transactions</h3>
            <p className="dashboard-card-text">
              View and categorize extracted spending data.
            </p>
            <span className="badge badge-neutral">Coming Soon</span>
          </div>
        </div>
      </div>
    </div>
  );
}
