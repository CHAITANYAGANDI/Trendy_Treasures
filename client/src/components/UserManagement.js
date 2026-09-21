import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Search, ShieldCheck, UserPlus } from 'lucide-react';
import { handleError, handleSuccess, logoutAdmin, apiFetch, showConfirm } from '../utils';
import AdminShell from './AdminShell';
import { Segmented, Spinner } from './ui/Primitives';
import AddAdminSheet from './AddAdminSheet';

const ROLE_TABS = [
  { id: 'all', label: 'Everyone' },
  { id: 'customer', label: 'Customers' },
  { id: 'admin', label: 'Admins' },
];

// One definition of "is this an admin", used by both the filter and the
// role badge.
//
// They used to disagree. The badge said "Shopper" for anything that was not
// Admin, but the filter matched `role === 'user'` — and the User model's
// enum is ['Admin', 'Customer'] with a default of 'Customer', so no account
// has ever had the role 'user'. That tab therefore always came back empty.
// Deriving both from this predicate means the list can only ever show what
// the badges say, whatever role strings the model grows later.
const isAdminUser = (user) => String((user && user.role) || '').toLowerCase() === 'admin';

// Admins and customers both sign in with an email, held in the same column,
// so the heading just names whichever audience the filter is showing.
const IDENTITY_HEADING = {
  all: 'Email',
  customer: 'Customer email',
  admin: 'Admin email',
};

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logoutAdmin();
    handleSuccess('Logged out successfully');
    setTimeout(() => navigate('/admin/login'), 800);
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/admin/users/get');
      if (response.ok) {
        const data = await response.json();
        setUsers(data || []);
      } else {
        const errorData = await response.json();
        if (errorData.message && errorData.message.toLowerCase().includes('token has expired')) {
          handleLogout();
        }
        handleError(errorData.message || 'Failed to fetch users');
      }
    } catch (error) {
      handleError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteAdmin = async (email) => {
    const ok = await showConfirm({
      title: 'Delete this admin?',
      body: 'They will lose access to the back office immediately. This cannot be undone.',
      confirmLabel: 'Delete admin',
      cancelLabel: 'Cancel',
      danger: true
    });
    if (!ok) return;
    try {
      const response = await apiFetch(`/admin/users/delete/${email}`, { method: 'DELETE' });
      if (response.ok) {
        handleSuccess('Admin deleted successfully');
        setUsers(users.filter((user) => user.email !== email));
      } else {
        const errorData = await response.json();
        handleError(errorData.message || 'Failed to delete admin');
      }
    } catch (error) {
      handleError(error.message);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchUsers(); }, []);

  const filtered = useMemo(() => {
    let list = users;
    if (roleFilter !== 'all') {
      const wantAdmin = roleFilter === 'admin';
      list = list.filter((u) => isAdminUser(u) === wantAdmin);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (u) =>
          (u.name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, query, roleFilter]);

  return (
    <AdminShell
      title="User management"
      subtitle="Accounts and admin access."
      actions={
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="btn btn-blue btn-sm"
        >
          <UserPlus size={15} aria-hidden="true" />
          Add admin
        </button>
      }
    >
      <div className="max-w-[1220px]">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <label className="search w-full sm:w-[320px]">
            <Search size={15} aria-hidden="true" className="shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email…"
              aria-label="Search accounts"
            />
          </label>
          <div className="sm:ml-auto">
            <Segmented
              options={ROLE_TABS}
              value={roleFilter}
              onChange={setRoleFilter}
              label="Filter by role"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-16 flex flex-col items-center gap-3" role="status">
            <Spinner size={24} />
            <p className="t-ui dim">Loading users…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center border-t border-hairline">
            <p className="t-ui dim">No users match your search.</p>
          </div>
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="idx">#</th>
                  <th>Name of the account holder</th>
                  <th>{IDENTITY_HEADING[roleFilter]}</th>
                  <th>Role</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user, index) => {
                  const isAdmin = isAdminUser(user);
                  const initial = user.name?.[0]?.toUpperCase() || '?';
                  return (
                    <tr key={user.email}>
                      <td className="idx">{index + 1}</td>
                      <td>
                        <span className="flex items-center gap-3">
                          <span className={`avatar ${isAdmin ? 'avatar-admin' : ''}`} aria-hidden="true">
                            {initial}
                          </span>
                          <span className="font-medium">{user.name}</span>
                        </span>
                      </td>
                      <td className="dim">{user.email}</td>
                      <td>
                        <span className={`rolechip ${isAdmin ? 'rolechip-admin' : ''}`}>
                          {isAdmin && <ShieldCheck size={12} aria-hidden="true" />}
                          {isAdmin ? 'Admin' : 'Customer'}
                        </span>
                      </td>
                      <td className="right">
                        {/* Delete exists on admin rows only — deleteUserById
                            rejects anything else server-side. */}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => deleteAdmin(user.email)}
                            className="icon-btn icon-btn-danger"
                            title="Delete admin"
                            aria-label={`Delete admin ${user.name || user.email}`}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Creating an admin is an action on this list, so it happens over
          the list and refreshes it in place. */}
      <AddAdminSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={fetchUsers}
      />
    </AdminShell>
  );
}

export default UserManagement;
