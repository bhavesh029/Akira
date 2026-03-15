import { useState, useEffect, type FormEvent } from 'react';
import { accountsApi, type Account, type CreateAccountPayload } from '../api/accounts';
import './Accounts.css';

const ACCOUNT_TYPE_LABELS: Record<Account['account_type'], string> = {
  SAVINGS: 'Savings',
  CURRENT: 'Current',
  CREDIT_CARD: 'Credit Card',
  LOAN: 'Loan',
  OTHER: 'Other',
};

const ACCOUNT_TYPE_OPTIONS = Object.entries(ACCOUNT_TYPE_LABELS) as [Account['account_type'], string][];

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const { data } = await accountsApi.getAll();
      setAccounts(data);
    } catch {
      setError('Failed to load accounts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const openCreate = () => {
    setEditingAccount(null);
    setShowModal(true);
  };

  const openEdit = (account: Account) => {
    setEditingAccount(account);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingAccount(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await accountsApi.remove(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      setDeleteConfirm(null);
    } catch {
      setError('Failed to delete account.');
    }
  };

  const handleSave = async (data: CreateAccountPayload) => {
    try {
      if (editingAccount) {
        const { data: updated } = await accountsApi.update(editingAccount.id, data);
        setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      } else {
        const { data: created } = await accountsApi.create(data);
        setAccounts((prev) => [created, ...prev]);
      }
      closeModal();
    } catch {
      throw new Error('Failed to save.');
    }
  };

  return (
    <div className="accounts-page">
      <div className="accounts-header">
        <div>
          <h2 className="accounts-title">Accounts</h2>
          <p className="accounts-subtitle">Manage your linked bank accounts</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Account
        </button>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading ? (
        <div className="accounts-loading">
          <span className="spinner" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏦</div>
          <h3 className="empty-state-title">No accounts yet</h3>
          <p className="empty-state-text">
            Add your first bank account to start uploading statements and extracting transactions.
          </p>
          <button className="btn btn-primary" onClick={openCreate}>Add Your First Account</button>
        </div>
      ) : (
        <div className="accounts-grid">
          {accounts.map((account) => (
            <div key={account.id} className="account-card">
              <div className="account-card-top">
                <div className="account-card-info">
                  <h3 className="account-card-bank">{account.bank_name}</h3>
                  <span className={`badge badge-blue`}>
                    {ACCOUNT_TYPE_LABELS[account.account_type]}
                  </span>
                </div>
                {account.account_number_last_four && (
                  <span className="account-card-number">
                    •••• {account.account_number_last_four}
                  </span>
                )}
              </div>
              <div className="account-card-meta">
                <span className="account-card-date">
                  Added {new Date(account.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <div className="account-card-actions">
                  <button className="btn btn-ghost" onClick={() => openEdit(account)}>Edit</button>
                  <button
                    className="btn btn-ghost account-card-delete"
                    onClick={() => setDeleteConfirm(account.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {deleteConfirm === account.id && (
                <div className="account-delete-confirm">
                  <p>Delete this account? This will also remove linked documents and transactions.</p>
                  <div className="account-delete-actions">
                    <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                    <button className="btn btn-danger" onClick={() => handleDelete(account.id)}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AccountModal
          account={editingAccount}
          onSave={handleSave}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

/* ---------- Account Modal ---------- */
function AccountModal({
  account,
  onSave,
  onClose,
}: {
  account: Account | null;
  onSave: (data: CreateAccountPayload) => Promise<void>;
  onClose: () => void;
}) {
  const [bankName, setBankName] = useState(account?.bank_name ?? '');
  const [accountType, setAccountType] = useState<Account['account_type']>(account?.account_type ?? 'SAVINGS');
  const [lastFour, setLastFour] = useState(account?.account_number_last_four ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!bankName.trim()) {
      setError('Bank name is required.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        bank_name: bankName.trim(),
        account_type: accountType,
        ...(lastFour ? { account_number_last_four: lastFour } : {}),
      });
    } catch {
      setError('Failed to save account. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{account ? 'Edit Account' : 'Add Account'}</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" htmlFor="modal-bank-name">Bank Name</label>
            <input
              id="modal-bank-name"
              className="form-input"
              type="text"
              placeholder="e.g. HDFC Bank"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" htmlFor="modal-account-type">Account Type</label>
            <select
              id="modal-account-type"
              className="form-select"
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as Account['account_type'])}
            >
              {ACCOUNT_TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="modal-last-four">Last 4 Digits (optional)</label>
            <input
              id="modal-last-four"
              className="form-input"
              type="text"
              placeholder="1234"
              maxLength={4}
              pattern="\d{4}"
              value={lastFour}
              onChange={(e) => setLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <span className="spinner" /> : account ? 'Save Changes' : 'Add Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
