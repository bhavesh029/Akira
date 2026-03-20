import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { analyticsApi, type AnalyticsSummary, type AiInsights } from '../api/analytics';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import './Dashboard.css';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6366f1'];

const DATE_RANGES = [
  { value: '1m', label: 'This Month' },
  { value: '3m', label: 'Past 3 Months' },
  { value: '6m', label: 'Past 6 Months' },
  { value: '1y', label: 'Past Year' },
  { value: 'all', label: 'All Time' },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [insights, setInsights] = useState<AiInsights | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingInsights, setLoadingInsights] = useState(true);
  const [errorSummary, setErrorSummary] = useState<string | null>(null);
  const [errorInsights, setErrorInsights] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState('all');

  const fetchData = () => {
    setErrorSummary(null);
    setErrorInsights(null);
    setLoadingSummary(true);
    setLoadingInsights(true);

    analyticsApi.getSummary(undefined, dateRange)
      .then((res) => setSummary(res.data))
      .catch((err) => setErrorSummary(err.response?.data?.message || 'Failed to load summary.'))
      .finally(() => setLoadingSummary(false));

    analyticsApi.getAiInsights(undefined, dateRange)
      .then((res) => setInsights(res.data))
      .catch((err) => setErrorInsights(err.response?.data?.message || 'Failed to load AI insights.'))
      .finally(() => setLoadingInsights(false));
  };

  useEffect(() => {
    fetchData();
  }, [dateRange]);

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2 className="dashboard-title">Financial Overview</h2>
          <p className="dashboard-subtitle">Welcome back, {user?.email}</p>
        </div>
        <select 
          className="date-range-select" 
          value={dateRange} 
          onChange={e => setDateRange(e.target.value)}
        >
          {DATE_RANGES.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* AI Hero Section */}
      <div className="dashboard-ai-hero">
        <div className="ai-hero-header">
          <span className="ai-hero-icon">✨</span>
          <span>Akira AI Insights</span>
        </div>
        {loadingInsights ? (
          <div>
            <div className="loading-skeleton" style={{ width: '100%' }}></div>
            <div className="loading-skeleton" style={{ width: '80%' }}></div>
            <div className="loading-skeleton" style={{ width: '90%' }}></div>
          </div>
        ) : errorInsights ? (
          <div>
            <p className="ai-summary-text" style={{ color: 'var(--color-error)' }}>{errorInsights}</p>
            <button type="button" className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={fetchData}>Retry</button>
          </div>
        ) : (
          <p className="ai-summary-text">{insights?.summary || "Upload more bank statements to generate personalized insights."}</p>
        )}
      </div>

      {/* Key Metrics */}
      {errorSummary && (
        <div className="auth-error" style={{ marginBottom: '1rem' }}>
          {errorSummary}
          <button type="button" className="btn btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={fetchData}>Retry</button>
        </div>
      )}
      {loadingSummary ? (
        <div className="metrics-grid">
          {[1,2,3,4].map(i => <div key={i} className="metric-card"><div className="loading-skeleton" /></div>)}
        </div>
      ) : summary && (
        <div className="metrics-grid">
          <div className="metric-card">
            <span className="metric-label">Total Outflow</span>
            <span className="metric-value">{formatCurrency(summary.metrics.totalOutflow)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Total Inflow</span>
            <span className="metric-value">{formatCurrency(summary.metrics.totalInflow)}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Net Cashflow</span>
            <span className={`metric-value ${summary.metrics.netBalance >= 0 ? 'positive' : 'negative'}`}>
              {summary.metrics.netBalance > 0 ? '+' : ''}{formatCurrency(summary.metrics.netBalance)}
            </span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Transactions Extracted</span>
            <span className="metric-value" style={{ color: 'var(--color-accent)' }}>{summary.metrics.transactionCount}</span>
          </div>
        </div>
      )}

      {/* Charts */}
      {summary && summary.cashflow.length > 0 && (
        <div className="charts-grid">
          <div className="chart-card">
            <h3 className="chart-title">Cashflow Trend (Last 6 Months)</h3>
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary.cashflow} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `₹${val/1000}k`} />
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                  <Tooltip 
                    formatter={(value: any) => formatCurrency(Number(value))}
                    contentStyle={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', borderRadius: '8px' }}
                  />
                  <Area type="monotone" dataKey="income" name="Income" stroke="#10b981" fillOpacity={1} fill="url(#colorIncome)" />
                  <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#ef4444" fillOpacity={1} fill="url(#colorExpenses)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-card">
            <h3 className="chart-title">Top Expense Categories</h3>
            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={summary.topCategories}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {summary.topCategories.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* AI Recognized Anomalies & Subscriptions */}
      <div className="charts-grid">
        <div className="list-card">
          <h3 className="chart-title">AI Anomalies & Alerts</h3>
          {loadingInsights ? (
            <div><div className="loading-skeleton"/><div className="loading-skeleton"/></div>
          ) : insights && insights.anomalies.length > 0 ? (
            insights.anomalies.map((a, i) => (
              <div key={i} className="anomaly-alert">
                <span>⚠️</span>
                <span>{a}</span>
              </div>
            ))
          ) : (
            <p style={{ color: 'var(--color-text-muted)' }}>No unusual spending detected.</p>
          )}

          {/* Fallback to SQL anomalies if AI didn't catch any, or to supplement */}
          {summary && summary.anomalies && summary.anomalies.length > 0 && (
             <div style={{ marginTop: 'var(--space-4)' }}>
              <h4 style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>Largest Recent Debits</h4>
              {summary.anomalies.map((tx: any) => (
                <div key={tx.id} className="list-item">
                  <div>
                    <div style={{ fontWeight: 500 }}>{tx.description || tx.category}</div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{tx.transaction_date}</div>
                  </div>
                  <div style={{ fontWeight: 600, color: 'var(--color-error)' }}>
                    {formatCurrency(tx.amount)}
                  </div>
                </div>
              ))}
             </div>
          )}
        </div>

        <div className="list-card">
          <h3 className="chart-title">Detected Subscriptions</h3>
          {loadingInsights ? (
            <div><div className="loading-skeleton"/><div className="loading-skeleton"/></div>
          ) : insights && insights.subscriptions.length > 0 ? (
            subscriptionsList(insights.subscriptions)
          ) : (
             <p style={{ color: 'var(--color-text-muted)' }}>No recurring active subscriptions identified.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function subscriptionsList(subs: any[]) {
  return subs.map((s, i) => (
    <div key={i} className="list-item">
      <div>
        <div style={{ fontWeight: 500 }}>{s.name}</div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{s.frequency}</div>
      </div>
      <div style={{ fontWeight: 600 }}>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(s.amount)}</div>
    </div>
  ));
}
