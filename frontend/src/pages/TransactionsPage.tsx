import { useState, useEffect, type FormEvent } from 'react';
import { transactionsApi, type TransactionItem, type CreateTransactionPayload } from '../api/transactions';
import { accountsApi, type Account } from '../api/accounts';
import './Transactions.css';

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTx, setEditingTx] = useState<TransactionItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Filters
  const [filterAccount, setFilterAccount] = useState('');
  const [filterType, setFilterType] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      const { data } = await transactionsApi.getAll({
        accountId: filterAccount || undefined,
        type: (filterType as 'CREDIT' | 'DEBIT') || undefined,
      });
      setTransactions(data);
    } catch {
      setError('Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    accountsApi.getAll().then(({ data }) => setAccounts(data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [filterAccount, filterType]);

  const filtered = transactions.filter((tx) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      tx.description?.toLowerCase().includes(term) ||
      tx.category?.toLowerCase().includes(term)
    );
  });

  const openCreate = () => { setEditingTx(null); setShowModal(true); };
  const openEdit = (tx: TransactionItem) => { setEditingTx(tx); setShowModal(true); };
  const closeModal = () => { setShowModal(false); setEditingTx(null); };

  const handleDelete = async (id: string) => {
    try {
      await transactionsApi.remove(id);
      setTransactions((prev) => prev.filter((t) => t.id !== id));
      setDeleteConfirm(null);
    } catch { setError('Failed to delete.'); }
  };

  const handleSave = async (data: CreateTransactionPayload) => {
    if (editingTx) {
      const { data: updated } = await transactionsApi.update(editingTx.id, data);
      setTransactions((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } else {
      const { data: created } = await transactionsApi.create(data);
      setTransactions((prev) => [created, ...prev]);
    }
    closeModal();
  };

  const formatAmount = (amount: number, type: string) => {
    const formatted = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(Math.abs(amount));
    return type === 'CREDIT' ? `+${formatted}` : `-${formatted}`;
  };

  return (
    <div className="transactions-page">
      <div className="transactions-header">
        <div>
          <h2 className="transactions-title">Transactions</h2>
          <p className="transactions-subtitle">View and manage financial transactions</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Transaction
        </button>
      </div>

      {/* Filters */}
      <div className="transactions-filters">
        <input
          className="form-input transactions-search"
          type="text"
          placeholder="Search description or category…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select className="form-select" value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
          <option value="">All Accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.bank_name}</option>)}
        </select>
        <select className="form-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          <option value="CREDIT">Credit</option>
          <option value="DEBIT">Debit</option>
        </select>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading ? (
        <div className="transactions-loading"><span className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💳</div>
          <h3 className="empty-state-title">{transactions.length === 0 ? 'No transactions yet' : 'No matching transactions'}</h3>
          <p className="empty-state-text">
            {transactions.length === 0
              ? 'Add your first transaction or upload a document for AI extraction.'
              : 'Try adjusting your search or filters.'}
          </p>
          {transactions.length === 0 && (
            <button className="btn btn-primary" onClick={openCreate}>Add Transaction</button>
          )}
        </div>
      ) : (
        <div className="transactions-table-wrap">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Account</th>
                <th className="transactions-col-amount">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx) => (
                <tr key={tx.id}>
                  <td className="transactions-date">
                    {new Date(tx.transaction_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="transactions-desc">{tx.description || '—'}</td>
                  <td>
                    {tx.category ? (
                      <span className="badge badge-neutral">{tx.category}</span>
                    ) : '—'}
                  </td>
                  <td className="transactions-account">{tx.account?.bank_name || '—'}</td>
                  <td className={`transactions-amount ${tx.type === 'CREDIT' ? 'transactions-credit' : 'transactions-debit'}`}>
                    {formatAmount(tx.amount, tx.type)}
                  </td>
                  <td className="transactions-actions">
                    <button className="btn btn-ghost" onClick={() => openEdit(tx)}>Edit</button>
                    <button className="btn btn-ghost transactions-delete-btn" onClick={() => setDeleteConfirm(tx.id)}>Delete</button>
                    {deleteConfirm === tx.id && (
                      <div className="transactions-delete-popup">
                        <p>Delete this transaction?</p>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                          <button className="btn btn-danger" onClick={() => handleDelete(tx.id)}>Delete</button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <TransactionModal
          transaction={editingTx}
          accounts={accounts}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

/* ---------- Transaction Modal ---------- */
function TransactionModal({
  transaction,
  accounts,
  onSave,
  onClose,
}: {
  transaction: TransactionItem | null;
  accounts: Account[];
  onSave: (data: CreateTransactionPayload) => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(transaction?.transaction_date?.split('T')[0] ?? new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState(transaction?.amount?.toString() ?? '');
  const [type, setType] = useState<'CREDIT' | 'DEBIT'>(transaction?.type ?? 'DEBIT');
  const [accountId, setAccountId] = useState(transaction?.accountId ?? (accounts[0]?.id || ''));
  const [category, setCategory] = useState(transaction?.category ?? '');
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!accountId) { setError('Account is required.'); return; }
    if (!amount || isNaN(Number(amount))) { setError('Valid amount is required.'); return; }

    setSaving(true);
    try {
      await onSave({
        transaction_date: date,
        amount: Number(amount),
        type,
        accountId,
        ...(category ? { category } : {}),
        ...(description ? { description } : {}),
      });
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
        <div className="modal-header">
          <h3 className="modal-title">{transaction ? 'Edit Transaction' : 'Add Transaction'}</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

          <div className="transaction-form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="tx-date">Date</label>
              <input id="tx-date" className="form-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="tx-amount">Amount (₹)</label>
              <input id="tx-amount" className="form-input" type="number" step="0.01" min="0" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
          </div>

          <div className="transaction-form-grid" style={{ marginTop: '1.25rem' }}>
            <div className="form-group">
              <label className="form-label">Type</label>
              <div className="transaction-type-toggle">
                <button type="button" className={`transaction-type-btn ${type === 'DEBIT' ? 'transaction-type-active-debit' : ''}`} onClick={() => setType('DEBIT')}>Debit</button>
                <button type="button" className={`transaction-type-btn ${type === 'CREDIT' ? 'transaction-type-active-credit' : ''}`} onClick={() => setType('CREDIT')}>Credit</button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="tx-account">Account</label>
              <select id="tx-account" className="form-select" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                <option value="">Select account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.bank_name} ({a.account_type})</option>)}
              </select>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '1.25rem' }}>
            <label className="form-label" htmlFor="tx-category">Category (optional)</label>
            <input id="tx-category" className="form-input" type="text" placeholder="e.g. Food, Rent, Salary" value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>

          <div className="form-group" style={{ marginTop: '1.25rem' }}>
            <label className="form-label" htmlFor="tx-description">Description (optional)</label>
            <input id="tx-description" className="form-input" type="text" placeholder="e.g. Swiggy order, Monthly rent" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner" /> : transaction ? 'Save Changes' : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
