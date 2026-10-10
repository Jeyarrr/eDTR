import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  Sun,
  Moon,
  Clock3,
  ShieldCheck,
  X,
  CalendarClock,
  ClipboardCheck,
  History,
  ArrowLeft,
  Eye,
  EyeOff,
  ArrowRight,
  LogOut,
} from 'lucide-react';
import { api, post, setCsrf } from './api';
import { Form, Field, Notice, State, useResource, Modal } from './ui';
import { Dashboard } from './pages/Dashboard';
import { AttendancePage } from './pages/Attendance';
import { EmployeesPage } from './pages/Employees';
import { RequestsPage } from './pages/Requests';
import { PayrollPage } from './pages/Payroll';
import { SchedulesPage, AuditPage } from './pages/Settings';
type AppContextType = {
  user: any;
  lookups: any;
  revision: number;
  refresh: () => void;
  notify: (text: string) => void;
  theme: string;
  toggleTheme: () => void;
};
const AppContext = createContext<AppContextType>(null!);
export const useApp = () => useContext(AppContext);
export default function App() {
  const [user, setUser] = useState<any>(null),
    [initial, setInitial] = useState(true),
    [revision, setRevision] = useState(0),
    [toast, setToast] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('edtr-theme') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('edtr-theme', theme);
  }, [theme]);
  useEffect(() => {
    api('/auth/me')
      .then((data) => {
        setUser(data.user);
        setCsrf(data.csrf_token);
      })
      .catch(() => {})
      .finally(() => setInitial(false));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const { data: lookups } = useResource(user ? '/lookups' : '/health', revision);
  const context = {
    user,
    lookups,
    revision,
    refresh: () => setRevision((v) => v + 1),
    notify: setToast,
    theme,
    toggleTheme: () => setTheme((v) => (v === 'light' ? 'dark' : 'light')),
  };
  if (initial)
    return (
      <div className="initial-loading">
        <Clock3 size={38} />
        <State loading />
      </div>
    );
  return (
    <AppContext.Provider value={context}>
      <Routes>
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/" replace />
            ) : (
              <AuthPage
                onLogin={(data) => {
                  setUser(data.user);
                  setCsrf(data.csrf_token);
                  setRevision((v) => v + 1);
                }}
              />
            )
          }
        />
        <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<AuthPage mode="reset" />} />
        <Route
          path="/*"
          element={
            user ? (
              <Shell
                onLogout={() => {
                  setUser(null);
                  setCsrf('');
                }}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={20} />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={17} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
function ThemeButton() {
  const { theme, toggleTheme } = useApp();
  return (
    <button
      className="icon-button theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
    </button>
  );
}
export function Logo({ className = '' }: { className?: string }) {
  const { theme } = useApp();
  return (
    <img
      className={`brand-logo ${className}`}
      src={`/assets/logo-${theme === 'dark' ? 'dark' : 'light'}-transparent.png`}
      alt="VioTech IT Solutions"
    />
  );
}
function Shell({ onLogout }: { onLogout: () => void }) {
  const { user, notify, theme, toggleTheme } = useApp(),
    location = useLocation(),
    [open, setOpen] = useState(false),
    [loggingOut, setLoggingOut] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false),
    [accountPanel, setAccountPanel] = useState('');
  const accountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const manager = user.role !== 'EMPLOYEE';
  const nav = [
    { to: '/', label: 'Dashboard', asset: 'nav-dashboard.svg' },
    {
      to: '/attendance',
      label: manager ? 'Attendance' : 'My attendance',
      asset: 'nav-attendance.svg',
    },
    { to: '/dtr', label: manager ? 'Employee Log' : 'My DTR', asset: 'nav-records.svg' },
    ...(manager
      ? [{ to: '/employees', label: 'User Management', asset: 'nav-employees.svg' }]
      : []),
    { to: '/requests', label: manager ? 'Requests' : 'My requests', icon: ClipboardCheck },
    { to: '/payroll', label: manager ? 'Payroll' : 'My payslips', asset: 'nav-payroll.svg' },
    ...(manager
      ? [
          { to: '/schedules', label: 'Work Schedules', icon: CalendarClock },
          { to: '/audit', label: 'Audit Logs', icon: History },
        ]
      : []),
  ];
  const title = nav.find((n) => n.to === location.pathname)?.label || 'Workspace';
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);
  async function logout() {
    setLoggingOut(true);
    try {
      await post('/auth/logout');
      onLogout();
    } catch (e: any) {
      notify(e.message);
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <div className="app-shell">
      {accountPanel && (
        <Modal title={accountPanel} onClose={() => setAccountPanel('')}>
          {accountPanel === 'Profile' ? (
            <div className="profile-details">
              <h3>{user.name}</h3>
              <p>{user.username || user.email}</p>
              <p>{user.email}</p>
              <p>
                {user.department} / {user.position}
              </p>
              <p>{user.role}</p>
            </div>
          ) : (
            <div className="profile-details">
              <p>Appearance</p>
              <button className="button secondary" onClick={toggleTheme}>
                Switch to {theme === 'light' ? 'dark' : 'light'} mode
              </button>
              <p>Timezone: Asia/Manila</p>
              <Link to="/forgot-password" onClick={() => setAccountPanel('')}>
                Reset password by email
              </Link>
            </div>
          )}
        </Modal>
      )}
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link className="sidebar-brand" to="/">
          <Logo />
          <div>
            <span>Electronic Daily Time Record</span>
          </div>
        </Link>
        <div className="nav-caption">{manager ? 'MANAGEMENT WORKSPACE' : 'EMPLOYEE WORKSPACE'}</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              {item.asset ? (
                <span className="nav-asset">
                  <img src={`/assets/${item.asset}`} alt="" />
                </span>
              ) : (
                item.icon && <item.icon size={21} />
              )}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="timezone-note">
            <Clock3 size={15} />
            <span>Asia/Manila · UTC+08:00</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <img src="/assets/menu.svg" alt="" />
          </button>
          <span className="topbar-title">{title}</span>
          <div className="topbar-right">
            <span className="secure-label">
              <ShieldCheck size={15} />
              Secure workspace
            </span>
            <ThemeButton />
            <span className="topbar-divider" />
            <div className="account-menu" ref={accountRef}>
              <button
                className="user-menu account-trigger"
                aria-label="Account menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((v) => !v)}
              >
                <span className="avatar">
                  {user.name
                    .split(' ')
                    .map((n: string) => n[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <div>
                  <strong>{user.name}</strong>
                  <small>
                    {user.role === 'EMPLOYEE'
                      ? user.employee_id
                      : user.role === 'ADMIN'
                        ? 'Administrator'
                        : 'Human resources'}
                  </small>
                </div>
              </button>
              {accountOpen && (
                <div className="account-dropdown">
                  <button
                    onClick={() => {
                      setAccountPanel('Profile');
                      setAccountOpen(false);
                    }}
                  >
                    Profile
                  </button>
                  <button
                    onClick={() => {
                      setAccountPanel('Settings');
                      setAccountOpen(false);
                    }}
                  >
                    Settings
                  </button>
                  <button onClick={logout} disabled={loggingOut}>
                    <LogOut size={16} />
                    {loggingOut ? 'Signing out...' : 'Logout'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/dtr" element={<AttendancePage history />} />
            <Route path="/requests" element={<RequestsPage />} />
            <Route path="/payroll" element={<PayrollPage />} />
            {manager && (
              <>
                <Route path="/employees" element={<EmployeesPage />} />
                <Route path="/schedules" element={<SchedulesPage />} />
                <Route path="/audit" element={<AuditPage />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <footer className="app-footer">
            <span>Attendance · Electronic Daily Time Record</span>
            <span>Timekeeping with a clear record.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function AuthPage({
  mode = 'login',
  onLogin,
}: {
  mode?: 'login' | 'forgot' | 'reset';
  onLogin?: (data: any) => void;
}) {
  const { theme } = useApp(),
    [visible, setVisible] = useState(false),
    [complete, setComplete] = useState(false);
  const navigate = useNavigate();
  const token = new URLSearchParams(useLocation().search).get('token');
  return (
    <div className={`auth-page ${mode !== 'login' ? 'recovery-page' : ''}`}>
      <div className="auth-top">
        <ThemeButton />
      </div>
      {mode === 'login' && (
        <section className="auth-brand-panel">
          <div className="auth-logo-frame">
            <Logo />
          </div>
          <span className="eyebrow">ELECTRONIC DAILY TIME RECORD</span>
          <h1>
            A better workday
            <br />
            starts with a clear record.
          </h1>
          <p>Your time. Your attendance. All in one place.</p>
          <div className="auth-brand-footer">
            <ShieldCheck size={17} />
            <span>Built for reliable, paperless timekeeping.</span>
          </div>
        </section>
      )}
      <section className="auth-card">
        {mode !== 'login' && (
          <Link className="back-link" to="/login">
            <ArrowLeft size={17} />
            Back to sign in
          </Link>
        )}
        {mode === 'forgot' && (
          <img className="recovery-key" src="/assets/recovery-key.svg" alt="" />
        )}
        {complete ? (
          <div className="auth-complete">
            <ShieldCheck size={44} />
            <h1>{mode === 'forgot' ? 'Check your email' : 'Your account is ready'}</h1>
            <p>
              {mode === 'forgot'
                ? 'If your email matches an active account, you will receive a recovery link. The link expires after 30 minutes.'
                : 'Your password has been saved. Sign in to continue to your workspace.'}
            </p>
            <Link className="button primary" to="/login">
              Back to sign in
              <ArrowRight size={17} />
            </Link>
          </div>
        ) : (
          <>
            <span className="eyebrow">
              {mode === 'login' ? 'WELCOME TO VIOTECH' : 'ACCOUNT RECOVERY'}
            </span>
            <h1>
              {mode === 'login'
                ? 'Welcome back!'
                : mode === 'forgot'
                  ? 'Forgot password?'
                  : 'Set your password'}
            </h1>
            <p>
              {mode === 'login'
                ? 'Sign in to manage and track your attendance.'
                : mode === 'forgot'
                  ? 'Enter your work email and we’ll help you get back in.'
                  : 'Create a strong password to secure your account.'}
            </p>
            <Form
              submit={
                mode === 'login'
                  ? 'Sign in'
                  : mode === 'forgot'
                    ? 'Send recovery link'
                    : 'Save password'
              }
              onSubmit={async (form) => {
                if (mode === 'login') {
                  const data = await post('/auth/login', {
                    email: form.get('email'),
                    password: form.get('password'),
                  });
                  onLogin?.(data);
                  navigate('/');
                } else if (mode === 'forgot') {
                  await post('/auth/forgot-password', { email: form.get('email') });
                  setComplete(true);
                } else {
                  if (form.get('password') !== form.get('confirm'))
                    throw new Error('Passwords do not match.');
                  await post('/auth/reset-password', { token, password: form.get('password') });
                  setComplete(true);
                }
              }}
            >
              {mode !== 'reset' && (
                <Field label={mode === 'login' ? 'Username or work email' : 'Work email'}>
                  <input
                    name="email"
                    type={mode === 'login' ? 'text' : 'email'}
                    required
                    placeholder={
                      mode === 'login' ? 'Username or you@company.com' : 'you@company.com'
                    }
                    autoComplete="username"
                  />
                </Field>
              )}
              {mode !== 'forgot' && (
                <>
                  <Field
                    label="Password"
                    hint={
                      mode === 'reset'
                        ? 'At least 12 characters, including uppercase, lowercase, and a number.'
                        : undefined
                    }
                  >
                    <div className="password-field">
                      <input
                        name="password"
                        type={visible ? 'text' : 'password'}
                        required
                        minLength={mode === 'reset' ? 12 : 1}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        placeholder={
                          mode === 'login' ? 'Enter your password' : 'Create a secure password'
                        }
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={visible ? 'Hide password' : 'Show password'}
                        onClick={() => setVisible((v) => !v)}
                      >
                        {!visible && theme === 'light' ? (
                          <img src="/assets/password-hidden.svg" alt="" />
                        ) : visible ? (
                          <Eye size={19} />
                        ) : (
                          <EyeOff size={19} />
                        )}
                      </button>
                    </div>
                  </Field>
                  {mode === 'login' ? (
                    <Link className="forgot-link" to="/forgot-password">
                      Forgot password?
                    </Link>
                  ) : (
                    <Field label="Confirm password">
                      <input
                        name="confirm"
                        type={visible ? 'text' : 'password'}
                        autoComplete="new-password"
                        minLength={12}
                        required
                        placeholder="Re-enter your password"
                      />
                    </Field>
                  )}
                </>
              )}
              {mode === 'reset' && !token && (
                <Notice>
                  This invitation or recovery link is missing a token. Ask your administrator for a
                  new link.
                </Notice>
              )}
            </Form>
            {mode === 'login' && (
              <div className="invitation-note">
                <ShieldCheck size={18} />
                <p>
                  New to the team?
                  <br />
                  <span>Ask your administrator for an account invitation.</span>
                </p>
              </div>
            )}
          </>
        )}
      </section>
      <span className="auth-copyright">
        © {new Date().getFullYear()} VioTech IT Solutions · Attendance
      </span>
    </div>
  );
}
