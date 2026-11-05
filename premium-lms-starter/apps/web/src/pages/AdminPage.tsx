import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiFetch } from '../auth/api.js';
import { useAuth } from '../auth/AuthProvider.js';
import { Alert, Badge, Button, Spinner, TextField } from '../components/ui.js';

interface UserListItem {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: string[];
  createdAt: string;
}

interface UsersResponse {
  items: UserListItem[];
  total: number;
  limit: number;
  offset: number;
}

interface AuditItem {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface AuditResponse {
  items: AuditItem[];
  total: number;
}

const ALL_ROLES = ['student', 'instructor', 'admin'] as const;
const PAGE_SIZE = 10;

/** Administration console for Phase 1 capabilities: users, roles, audit. */
export function AdminPage() {
  const { user: me } = useAuth();

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(true);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadUsers = useCallback(async (offsetValue: number, searchValue: string) => {
    setLoadingUsers(true);
    setUsersError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offsetValue) });
      if (searchValue) params.set('q', searchValue);
      const data = await apiFetch<UsersResponse>(`/api/admin/users?${params.toString()}`);
      setUsers(data.items);
      setTotal(data.total);
    } catch (error) {
      setUsersError(error instanceof ApiError ? error.message : 'Could not load users.');
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    setLoadingAudit(true);
    setAuditError(null);
    try {
      const data = await apiFetch<AuditResponse>('/api/admin/audit-events?limit=20');
      setAudit(data.items);
    } catch (error) {
      setAuditError(error instanceof ApiError ? error.message : 'Could not load audit events.');
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers(0, '');
    void loadAudit();
  }, [loadUsers, loadAudit]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const next = search.trim();
    setQuery(next);
    setOffset(0);
    void loadUsers(0, next);
  }

  function goToPage(nextOffset: number) {
    setOffset(nextOffset);
    void loadUsers(nextOffset, query);
  }

  async function handleRolesSubmit(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const roles = ALL_ROLES.filter((role) => {
      const input = form.elements.namedItem(role) as HTMLInputElement | null;
      return input?.checked;
    });
    if (roles.length === 0) {
      setActionError('Select at least one role.');
      return;
    }

    setSavingId(userId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const data = await apiFetch<{ changes: { added: string[]; removed: string[] } }>(
        `/api/admin/users/${userId}/roles`,
        { method: 'PATCH', body: JSON.stringify({ roles }) },
      );
      const changed =
        data.changes.added.length > 0 || data.changes.removed.length > 0
          ? `Updated roles (+${data.changes.added.join(', ') || 'none'} / −${data.changes.removed.join(', ') || 'none'}).`
          : 'No role changes needed.';
      setActionSuccess(changed);
      await loadUsers(offset, query);
      await loadAudit();
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'Could not update roles.');
    } finally {
      setSavingId(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Administration</h1>
        </div>
        <span className="muted">Signed in as {me?.email}</span>
      </header>

      {actionError ? <Alert>{actionError}</Alert> : null}
      {actionSuccess ? <Alert kind="success">{actionSuccess}</Alert> : null}

      <section className="panel">
        <div className="section-head">
          <h2>Users</h2>
          <form className="inline-form" onSubmit={handleSearch} role="search">
            <TextField
              label="Search users"
              name="q"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="name or email"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
        </div>

        {loadingUsers ? (
          <Spinner label="Loading users…" />
        ) : usersError ? (
          <Alert>{usersError}</Alert>
        ) : users.length === 0 ? (
          <p className="muted">No users match this search.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Roles</th>
                  <th scope="col">Change roles</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.email}</td>
                    <td className="capitalize">{item.status}</td>
                    <td className="badge-row">
                      {item.roles.map((role) => (
                        <Badge key={role}>{role}</Badge>
                      ))}
                    </td>
                    <td>
                      <form
                        className="role-form"
                        onSubmit={(event) => void handleRolesSubmit(event, item.id)}
                      >
                        {ALL_ROLES.map((role) => (
                          <label key={role} className="checkbox">
                            <input
                              type="checkbox"
                              name={role}
                              defaultChecked={item.roles.includes(role)}
                              disabled={savingId !== null}
                            />
                            <span>{role}</span>
                          </label>
                        ))}
                        <Button
                          type="submit"
                          variant="secondary"
                          loading={savingId === item.id}
                          disabled={savingId !== null && savingId !== item.id}
                        >
                          Save
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loadingUsers && total > PAGE_SIZE ? (
          <div className="pager">
            <Button
              variant="ghost"
              disabled={offset === 0}
              onClick={() => goToPage(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <span className="muted">
              Page {Math.floor(offset / PAGE_SIZE) + 1} of {pageCount}
            </span>
            <Button
              variant="ghost"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => goToPage(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>Audit events</h2>
        <p className="muted">Sensitive actions are recorded with actor, target and timestamp.</p>
        {loadingAudit ? (
          <Spinner label="Loading audit events…" />
        ) : auditError ? (
          <Alert>{auditError}</Alert>
        ) : audit.length === 0 ? (
          <p className="muted">No audit events yet.</p>
        ) : (
          <ul className="audit-list">
            {audit.map((event) => (
              <li key={event.id}>
                <code>{event.action}</code>
                <span className="muted">
                  {event.targetType ? `${event.targetType} · ${event.targetId}` : '—'}
                </span>
                <span className="muted">{new Date(event.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
