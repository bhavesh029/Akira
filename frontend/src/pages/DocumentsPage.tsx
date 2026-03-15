import { useState, useEffect, useRef, type FormEvent } from 'react';
import { documentsApi, type DocumentItem } from '../api/documents';
import { accountsApi, type Account } from '../api/accounts';
import './Documents.css';

const STATUS_CONFIG: Record<DocumentItem['status'], { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'badge-neutral' },
  PROCESSING: { label: 'Processing', className: 'badge-blue' },
  COMPLETED: { label: 'Completed', className: 'badge-green' },
  FAILED: { label: 'Failed', className: 'badge-red' },
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [filterAccount, setFilterAccount] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const { data } = await documentsApi.getAll(filterAccount || undefined);
      setDocuments(data);
    } catch {
      setError('Failed to load documents.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAccounts = async () => {
    try {
      const { data } = await accountsApi.getAll();
      setAccounts(data);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [filterAccount]);

  // Auto-poll while any document is PENDING or PROCESSING
  useEffect(() => {
    const hasInProgress = documents.some(
      (d) => d.status === 'PENDING' || d.status === 'PROCESSING',
    );
    if (!hasInProgress) return;

    const interval = setInterval(async () => {
      try {
        const { data } = await documentsApi.getAll(filterAccount || undefined);
        setDocuments(data);
      } catch { /* ignore polling errors */ }
    }, 3000);

    return () => clearInterval(interval);
  }, [documents, filterAccount]);

  const handleDelete = async (id: string) => {
    try {
      await documentsApi.remove(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      setDeleteConfirm(null);
    } catch {
      setError('Failed to delete document.');
    }
  };

  const handleUploadComplete = (doc: DocumentItem) => {
    setDocuments((prev) => [doc, ...prev]);
    setShowUpload(false);
  };

  return (
    <div className="documents-page">
      <div className="documents-header">
        <div>
          <h2 className="documents-title">Documents</h2>
          <p className="documents-subtitle">Upload and manage bank statements</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17,8 12,3 7,8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload
        </button>
      </div>

      {/* Filter bar */}
      <div className="documents-filters">
        <select
          className="form-select"
          value={filterAccount}
          onChange={(e) => setFilterAccount(e.target.value)}
        >
          <option value="">All Accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.bank_name} ({a.account_type})</option>
          ))}
        </select>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {loading ? (
        <div className="documents-loading"><span className="spinner" /></div>
      ) : documents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <h3 className="empty-state-title">No documents yet</h3>
          <p className="empty-state-text">
            Upload your first bank statement to start extracting transaction data.
          </p>
          <button className="btn btn-primary" onClick={() => setShowUpload(true)}>Upload Statement</button>
        </div>
      ) : (
        <div className="documents-table-wrap">
          <table className="documents-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Account</th>
                <th>Status</th>
                <th>Uploaded</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const status = STATUS_CONFIG[doc.status];
                return (
                  <tr key={doc.id}>
                    <td className="documents-table-title">
                      {doc.download_url ? (
                        <a href={doc.download_url} target="_blank" rel="noreferrer">{doc.title}</a>
                      ) : (
                        doc.title
                      )}
                    </td>
                    <td className="documents-table-account">
                      {doc.account ? doc.account.bank_name : '—'}
                    </td>
                    <td>
                      <span className={`badge ${status.className}`}>{status.label}</span>
                    </td>
                    <td className="documents-table-date">
                      {new Date(doc.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="documents-table-actions">
                      <button
                        className="btn btn-ghost documents-delete-btn"
                        onClick={() => setDeleteConfirm(doc.id)}
                      >
                        Delete
                      </button>
                      {deleteConfirm === doc.id && (
                        <div className="documents-delete-popup">
                          <p>Delete this document?</p>
                          <div className="documents-delete-actions">
                            <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(doc.id)}>Delete</button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showUpload && (
        <UploadModal
          accounts={accounts}
          onComplete={handleUploadComplete}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}

/* ---------- Upload Modal ---------- */
function UploadModal({
  accounts,
  onComplete,
  onClose,
}: {
  accounts: Account[];
  onComplete: (doc: DocumentItem) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) {
      setFile(dropped);
      if (!title) setTitle(dropped.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      if (!title) setTitle(selected.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!file) {
      setError('Please select a file.');
      return;
    }
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setUploading(true);
    try {
      const { data } = await documentsApi.upload(
        file,
        title.trim(),
        accountId || undefined,
        password || undefined,
      );
      onComplete(data);
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Upload Document</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="auth-error" style={{ marginBottom: '1rem' }}>{error}</div>}

          {/* Dropzone */}
          <div
            className={`upload-dropzone ${dragging ? 'upload-dropzone-active' : ''} ${file ? 'upload-dropzone-has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.csv"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {file ? (
              <div className="upload-dropzone-file">
                <span className="upload-dropzone-icon">📎</span>
                <span className="upload-dropzone-name">{file.name}</span>
                <span className="upload-dropzone-size">{(file.size / 1024).toFixed(0)} KB</span>
              </div>
            ) : (
              <>
                <span className="upload-dropzone-icon">📤</span>
                <p className="upload-dropzone-text">
                  Drag & drop a file here, or <strong>click to browse</strong>
                </p>
                <p className="upload-dropzone-hint">PDF, PNG, JPG, CSV — Max 20 MB</p>
              </>
            )}
          </div>

          <div className="form-group" style={{ marginTop: '1.25rem' }}>
            <label className="form-label" htmlFor="upload-title">Document Title</label>
            <input
              id="upload-title"
              className="form-input"
              type="text"
              placeholder="e.g. HDFC Statement - March 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-group" style={{ marginTop: '1.25rem' }}>
            <label className="form-label" htmlFor="upload-account">Link to Account (optional)</label>
            <select
              id="upload-account"
              className="form-select"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">None</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.bank_name} ({a.account_type})</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginTop: '1.25rem' }}>
            <label className="form-label" htmlFor="upload-password">PDF Password (if protected)</label>
            <input
              id="upload-password"
              className="form-input"
              type="password"
              placeholder="e.g. your PAN or DOB"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={uploading}>
              {uploading ? <span className="spinner" /> : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
