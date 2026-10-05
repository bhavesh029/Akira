import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { documentsApi, type DocumentItem } from '../api/documents';
import { transactionsApi, type TransactionItem } from '../api/transactions';
import './Transactions.css';
import './Review.css';

function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}

const PAGE_LIMIT = 100;

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const documentId = Number(id);

  const [doc, setDoc] = useState<DocumentItem | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmingAll, setConfirmingAll] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [{ data: docData }, firstPage] = await Promise.all([
        documentsApi.getOne(documentId),
        transactionsApi.getAll({ documentId, page: 1, limit: PAGE_LIMIT }),
      ]);
      setDoc(docData);

      let all = firstPage.data.data;
      const totalPages = firstPage.data.totalPages;
      for (let page = 2; page <= totalPages; page++) {
        const { data } = await transactionsApi.getAll({ documentId, page, limit: PAGE_LIMIT });
        all = all.concat(data.data);
      }
      setTransactions(all);
    } catch {
      setError('Failed to load this document for review.');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const unreviewedCount = transactions.filter((t) => !t.reviewed).length;

  const handleConfirmAll = async () => {
    setConfirmingAll(true);
    try {
      await documentsApi.confirmReview(documentId);
      setTransactions((prev) => prev.map((t) => ({ ...t, reviewed: true })));
    } catch {
      setError('Failed to confirm all transactions.');
    } finally {
      setConfirmingAll(false);
    }
  };

  const handleRowSaved = (updated: TransactionItem) => {
    setTransactions((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  if (loading) {
    return (
      <div className="review-page">
        <div className="review-loading"><span className="spinner" /></div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="review-page">
        <div className="auth-error">{error || 'Document not found.'}</div>
      </div>
    );
  }

  return (
    <div className="review-page">
      <div className="review-header">
        <div>
          <Link to="/documents" className="review-back-link">&larr; Documents</Link>
          <h2 className="review-title">Review: {doc.title}</h2>
          <p className="review-subtitle">
            {unreviewedCount === 0
              ? 'All transactions in this document are reviewed and confirmed.'
              : `${unreviewedCount} of ${transactions.length} transaction${transactions.length === 1 ? '' : 's'} still need review.`}
          </p>
        </div>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <ReconciliationBanner
        doc={doc}
        unreviewedCount={unreviewedCount}
        confirmingAll={confirmingAll}
        onConfirmAll={handleConfirmAll}
      />

      {transactions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <h3 className="empty-state-title">No transactions extracted</h3>
          <p className="empty-state-text">Nothing was extracted from this document.</p>
        </div>
      ) : (
        <div className="review-list">
          {transactions.map((tx) => (
            <ReviewRow key={tx.id} transaction={tx} onSaved={handleRowSaved} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReconciliationBanner({
  doc,
  unreviewedCount,
  confirmingAll,
  onConfirmAll,
}: {
  doc: DocumentItem;
  unreviewedCount: number;
  confirmingAll: boolean;
  onConfirmAll: () => void;
}) {
  if (doc.reconciliation_status === 'MATCHED') {
    return (
      <div className="review-banner review-banner-matched">
        <div>
          <p className="review-banner-title">Reconciliation matched</p>
          <p className="review-banner-text">
            Opening balance {formatInr(doc.opening_balance ?? 0)} and the extracted
            transactions reconcile against the statement&apos;s closing balance of{' '}
            {formatInr(doc.closing_balance ?? 0)}.
          </p>
        </div>
        {unreviewedCount > 0 && (
          <button className="btn btn-primary" onClick={onConfirmAll} disabled={confirmingAll}>
            {confirmingAll ? <span className="spinner" /> : `Confirm all ${unreviewedCount}`}
          </button>
        )}
      </div>
    );
  }

  if (doc.reconciliation_status === 'MISMATCH') {
    return (
      <div className="review-banner review-banner-mismatch">
        <p className="review-banner-title">Reconciliation mismatch</p>
        <p className="review-banner-text">
          Expected a closing balance of {formatInr(doc.closing_balance ?? 0)} starting from{' '}
          {formatInr(doc.opening_balance ?? 0)}, but the extracted transactions are off by{' '}
          {formatInr(Math.abs(doc.reconciled_delta ?? 0))}. Review each transaction
          individually below before confirming.
        </p>
      </div>
    );
  }

  return (
    <div className="review-banner review-banner-na">
      <p className="review-banner-title">No statement balance found</p>
      <p className="review-banner-text">
        This statement didn&apos;t have a clear opening/closing balance to reconcile against —
        review each transaction individually below before confirming.
      </p>
    </div>
  );
}

function ReviewRow({
  transaction,
  onSaved,
}: {
  transaction: TransactionItem;
  onSaved: (updated: TransactionItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(transaction.transaction_date.split('T')[0]);
  const [amount, setAmount] = useState(String(transaction.amount));
  const [type, setType] = useState(transaction.type);
  const [category, setCategory] = useState(transaction.category ?? '');
  const [description, setDescription] = useState(transaction.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const startEdit = () => {
    setDate(transaction.transaction_date.split('T')[0]);
    setAmount(String(transaction.amount));
    setType(transaction.type);
    setCategory(transaction.category ?? '');
    setDescription(transaction.description ?? '');
    setError('');
    setEditing(true);
  };

  const handleSaveAndConfirm = async () => {
    if (!amount || isNaN(Number(amount))) {
      setError('Valid amount is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data } = await transactionsApi.update(transaction.id, {
        transaction_date: date,
        amount: Number(amount),
        type,
        category: category || undefined,
        description: description || undefined,
        reviewed: true,
      });
      onSaved(data);
      setEditing(false);
    } catch {
      setError('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError('');
    try {
      const { data } = await transactionsApi.update(transaction.id, { reviewed: true });
      onSaved(data);
    } catch {
      setError('Failed to confirm.');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="review-row review-row-editing">
        {error && <div className="auth-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <div className="review-row-edit-grid">
          <input className="form-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input className="form-input" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="transaction-type-toggle">
            <button type="button" className={`transaction-type-btn ${type === 'DEBIT' ? 'transaction-type-active-debit' : ''}`} onClick={() => setType('DEBIT')}>Debit</button>
            <button type="button" className={`transaction-type-btn ${type === 'CREDIT' ? 'transaction-type-active-credit' : ''}`} onClick={() => setType('CREDIT')}>Credit</button>
          </div>
          <input className="form-input" type="text" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input className="form-input review-row-desc-input" type="text" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="review-row-actions">
          <button className="btn btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSaveAndConfirm} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save & Confirm'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`review-row ${transaction.reviewed ? 'review-row-reviewed' : ''}`}>
      <div className="review-row-date">
        {new Date(transaction.transaction_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
      </div>
      <div className="review-row-desc">{transaction.description || '—'}</div>
      <div className="review-row-category">
        {transaction.category ? <span className="badge badge-neutral">{transaction.category}</span> : '—'}
      </div>
      <div className={`review-row-amount ${transaction.type === 'CREDIT' ? 'transactions-credit' : 'transactions-debit'}`}>
        {transaction.type === 'CREDIT' ? '+' : '-'}{formatInr(Math.abs(transaction.amount))}
      </div>
      <div className="review-row-status">
        {transaction.reviewed ? (
          <span className="badge badge-green">Reviewed</span>
        ) : (
          <span className="badge badge-neutral">Unreviewed</span>
        )}
      </div>
      <div className="review-row-actions">
        {!transaction.reviewed && (
          <>
            <button className="btn btn-ghost" onClick={startEdit}>Edit</button>
            <button className="btn btn-secondary" onClick={handleConfirm} disabled={saving}>
              {saving ? <span className="spinner" /> : 'Confirm'}
            </button>
          </>
        )}
      </div>
      {error && <div className="auth-error review-row-error">{error}</div>}
    </div>
  );
}
