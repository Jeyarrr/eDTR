import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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
  LayoutDashboard,
  CalendarCheck,
  FileClock,
  UsersRound,
  Wallet,
  Menu,
  PanelLeft,
  ChevronRight,
  ChevronDown,
  UserRound,
  Settings2,
  ArrowUpRight,
  CircleHelp,
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
  const [theme, setTheme] = useState(() => localStorage.getItem('edtr-theme') || 'dark');
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
      src={
        theme === 'dark' ? '/assets/viotech-transparent.png' : '/assets/logo-light-transparent.png'
      }
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
    [accountPanel, setAccountPanel] = useState(''),
    [collapsed, setCollapsed] = useState(false);
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
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    {
      to: '/attendance',
      label: manager ? 'Attendance' : 'My attendance',
      icon: CalendarCheck,
    },
    { to: '/dtr', label: manager ? 'Employee Log' : 'My DTR', icon: FileClock },
    ...(manager ? [{ to: '/employees', label: 'User Management', icon: UsersRound }] : []),
    { to: '/requests', label: manager ? 'Requests' : 'My requests', icon: ClipboardCheck },
    { to: '/payroll', label: manager ? 'Payroll' : 'My payslips', icon: Wallet },
    ...(manager
      ? [
          { to: '/schedules', label: 'Work Schedules', icon: CalendarClock },
          { to: '/audit', label: 'Audit Logs', icon: History },
        ]
      : []),
  ];
  const title = nav.find((n) => n.to === location.pathname)?.label || 'Workspace';
  const navGroups = [
    { label: 'Workspace', paths: ['/', '/attendance', '/dtr'] },
    { label: 'People & operations', paths: ['/employees', '/requests', '/payroll'] },
    { label: 'Administration', paths: ['/schedules', '/audit'] },
  ];
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
    <div className={`app-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
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
      <aside className={`sidebar ${open ? 'open' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <Link className="sidebar-brand" to="/">
          <Logo />
          <div>
            <span>Electronic Daily Time Record</span>
          </div>
        </Link>
        <nav className="workspace-nav" aria-label="Main navigation">
          {navGroups.map((group) => {
            const items = nav.filter((item) => group.paths.includes(item.to));
            return (
              items.length > 0 && (
                <div className="nav-group" key={group.label}>
                  <p className="nav-caption">{group.label}</p>
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    >
                      <item.icon size={18} strokeWidth={1.7} />
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              )
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="timezone-note">
            <span className="workspace-status-dot" />
            <span>Workspace connected</span>
            <ArrowUpRight size={13} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-button"
              aria-label="Open navigation"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <Menu size={20} />
            </button>
            <button
              className="icon-button desktop-collapse"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((value) => !value)}
            >
              <PanelLeft size={18} />
            </button>
            <span className="topbar-divider" />
            <span className="breadcrumb-workspace">Workspace</span>
            <ChevronRight size={13} className="breadcrumb-chevron" />
            <span className="topbar-title">{title}</span>
          </div>
          <div className="topbar-right">
            <ThemeButton />
            <span className="secure-label">
              <ShieldCheck size={15} />
              Secure workspace
            </span>
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
                <div className="account-details">
                  <strong>{user.name}</strong>
                  <small>
                    {user.role === 'EMPLOYEE'
                      ? user.employee_id
                      : user.role === 'ADMIN'
                        ? 'Administrator'
                        : 'Human resources'}
                  </small>
                </div>
                <ChevronDown size={14} />
              </button>
              {accountOpen && (
                <div className="account-dropdown">
                  <div className="dropdown-user">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </div>
                  <hr />
                  <button
                    onClick={() => {
                      setAccountPanel('Profile');
                      setAccountOpen(false);
                    }}
                  >
                    <UserRound size={16} /> Profile
                  </button>
                  <button
                    onClick={() => {
                      setAccountPanel('Settings');
                      setAccountOpen(false);
                    }}
                  >
                    <Settings2 size={16} /> Settings
                  </button>
                  <hr />
                  <button onClick={logout} disabled={loggingOut}>
                    <LogOut size={16} />
                    {loggingOut ? 'Signing out...' : 'Logout'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
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
        </main>
        <footer className="app-footer">
          <span>© {new Date().getFullYear()} Viotech I.T. Solutions</span>
          <span>
            <CircleHelp size={13} /> Attendance workspace{' '}
            <span className="footer-version">Core workspace</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
async function unfoldLogin(update: () => void) {
  if (
    !document.startViewTransition ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    update();
    return;
  }
  const root = document.documentElement;
  let committed = false;
  const commit = () => {
    committed = true;
    flushSync(update);
  };
  root.dataset.loginTransition = 'unfold';
  try {
    const transition = document.startViewTransition(commit);
    await transition.finished;
  } catch {
    // A skipped or unsupported transition must never prevent a successful sign-in.
    if (!committed) commit();
  } finally {
    delete root.dataset.loginTransition;
  }
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
    <div className={`auth-page ${mode === 'login' ? 'login-page company-login' : 'recovery-page'}`}>
      {mode === 'login' && (
        <section
          className="auth-brand-panel login-story"
          aria-label="About the attendance workspace"
        >
          <Link to="/login" className="login-brand-link" aria-label="VioTech attendance login">
            <img
              className="brand-logo"
              src="/assets/viotech-transparent.png"
              alt="VioTech IT Solutions"
            />
          </Link>
          <div className="story-main">
            <span className="eyebrow">
              <span className="small-line" /> VIOTECH TIME OPERATIONS
            </span>
            <h1>
              Time operations.
              <br />
              <span>One workspace.</span>
            </h1>
            <p>
              One connected workspace for the people,
              <br className="desktop-break" /> schedules, and workdays moving Viotech forward.
            </p>
            <div className="login-capabilities" aria-label="Attendance features">
              {[
                {
                  icon: Clock3,
                  title: 'Time & attendance',
                  description: 'A clear record of every workday, in one place.',
                },
                {
                  icon: CalendarClock,
                  title: 'Schedules & approvals',
                  description: 'Clear responsibilities. Reliable timekeeping.',
                },
                {
                  icon: UsersRound,
                  title: 'People & payroll',
                  description: 'One workspace for the teams behind the work.',
                },
              ].map((item) => (
                <div className="login-capability" key={item.title}>
                  <span>
                    <item.icon size={18} strokeWidth={1.6} />
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="story-footer">
            <span>VIOTECH I.T. SOLUTIONS</span>
            <span>
              Your work, connected. <ArrowRight size={15} />
            </span>
          </div>
        </section>
      )}
      <section className={mode === 'login' ? 'login-form-panel' : 'recovery-form-panel'}>
        {mode !== 'login' && (
          <div className="auth-top">
            <ThemeButton />
          </div>
        )}
        {mode === 'login' && (
          <div className="login-mobile-brand">
            <img
              className="brand-logo"
              src="/assets/viotech-transparent.png"
              alt="VioTech IT Solutions"
            />
          </div>
        )}
        <section className={`auth-card ${mode === 'login' ? 'login-form-wrap' : ''}`}>
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
                {mode === 'login' ? 'YOUR VIOTECH WORKSPACE' : 'ACCOUNT RECOVERY'}
              </span>
              {mode === 'login' ? (
                <h2>Welcome back.</h2>
              ) : (
                <h1>{mode === 'forgot' ? 'Forgot password?' : 'Set your password'}</h1>
              )}
              <p>
                {mode === 'login'
                  ? 'Sign in to get a clear picture of your work.'
                  : mode === 'forgot'
                    ? 'Enter your work email and we’ll help you get back in.'
                    : 'Create a strong password to secure your account.'}
              </p>
              <Form
                busyLabel={mode === 'login' ? 'Signing in…' : undefined}
                submitIcon={mode === 'login' ? <ArrowRight size={17} /> : undefined}
                submit={
                  mode === 'login'
                    ? 'Sign in to workspace'
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
                    await unfoldLogin(() => {
                      onLogin?.(data);
                      navigate('/', { replace: true });
                    });
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
                  <Field label={mode === 'login' ? 'Email or username' : 'Work email'}>
                    <input
                      name="email"
                      type={mode === 'login' ? 'text' : 'email'}
                      required
                      placeholder={mode === 'login' ? 'you@viotech.com' : 'you@company.com'}
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
                          aria-pressed={visible}
                          onClick={() => setVisible((v) => !v)}
                        >
                          {mode === 'login' ? (
                            visible ? (
                              <EyeOff size={18} />
                            ) : (
                              <Eye size={18} />
                            )
                          ) : !visible && theme === 'light' ? (
                            <img src="/assets/password-hidden.svg" alt="" />
                          ) : visible ? (
                            <Eye size={19} />
                          ) : (
                            <EyeOff size={19} />
                          )}
                        </button>
                      </div>
                    </Field>
                    {mode === 'reset' && (
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
                    This invitation or recovery link is missing a token. Ask your administrator for
                    a new link.
                  </Notice>
                )}
              </Form>
              {mode === 'login' && (
                <>
                  <p className="login-help">
                    <Link to="/forgot-password" aria-label="Forgot password?">
                      Need access or help signing in?
                    </Link>
                    <br />
                    <span>Contact your Viotech system administrator.</span>
                  </p>
                  <div className="login-security">
                    <ShieldCheck size={15} />
                    <span>Protected sign-in for your company workspace.</span>
                  </div>
                </>
              )}
            </>
          )}
        </section>
        <div className={`auth-copyright ${mode === 'login' ? 'login-form-footer' : ''}`}>
          <span>Attendance workspace</span>
          <span>© {mode === 'login' ? 2025 : new Date().getFullYear()} Viotech</span>
        </div>
      </section>
    </div>
  );
}
