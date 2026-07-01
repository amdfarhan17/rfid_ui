'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Icons (inline SVG to avoid lucide-react version issues) ──────────────────
const Icon = ({ d, size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const UserIcon = () => <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />;
const CpuIcon = () => <Icon d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 0 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 0-2-2V9m0 0h18" />;
const PowerIcon = () => <Icon d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />;
const RefreshIcon = () => <Icon d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />;
const ClockIcon = () => <Icon d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2" />;
const FileIcon = () => <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />;

// ─────────────────────────────────────────────────────────────────────────────

function OperatorsContent() {
  const [espIP, setEspIP] = useState('');
  const [espBase, setEspBase] = useState('');
  const [connStatus, setConnStatus] = useState('Disconnected'); // 'Disconnected' | 'Connecting' | 'Live'
  const [status, setStatus] = useState(null);
  const [logEntries, setLogEntries] = useState([]);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [lastSeen, setLastSeen] = useState(null);

  const pollRef = useRef(null);
  const tickRef = useRef(null);
  const prevActive = useRef(false);
  const logRef = useRef([]); // mirror logEntries without stale closure

  // ── Restore saved IP (SSR-safe: window/localStorage only exist client-side) ─
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('esp32_ip');
    if (saved) setEspIP(saved);
  }, []);

  // ── Fetch /status from ESP32 ──────────────────────────────────────────────
  const fetchStatus = useCallback(async (base) => {
    if (!base) return;
    try {
      const res = await fetch(`${base}/status`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      setStatus(data);
      setConnStatus('Live');
      setLastSeen(new Date());

      // Sync session timer with ESP value
      // if (data.active && typeof data.session_seconds === 'number') {
      //   setSessionSeconds(data.session_seconds);
      // }
      setSessionSeconds(Number(data.session_seconds || 0));

      // Build access log from state transitions
      if (data.active && !prevActive.current) {
        // LOGIN event
        const entry = {
          time: new Date().toLocaleTimeString(),
          name: data.operator_name || '—',
          id: data.operator_id || '—',
          machine: `${data.machine_name || '—'} (${data.machine_id || '—'})`,
          shift: data.shift || '—',
          action: 'LOGIN',
        };
        const updated = [entry, ...logRef.current];
        logRef.current = updated;
        setLogEntries(updated);
      } else if (!data.active && prevActive.current) {
        // LOGOUT event
        const entry = {
          time: new Date().toLocaleTimeString(),
          name: logRef.current[0]?.name || '—',
          id: logRef.current[0]?.id || '—',
          machine: logRef.current[0]?.machine || '—',
          shift: data.shift || '—',
          action: 'LOGOUT',
        };
        const updated = [entry, ...logRef.current];
        logRef.current = updated;
        setLogEntries(updated);
      }

      prevActive.current = data.active;
    } catch {
      setConnStatus('Disconnected');
    }
  }, []);

  // ── Start / stop polling ──────────────────────────────────────────────────
  useEffect(() => {
    if (!espBase) return;
    setConnStatus('Connecting');
    fetchStatus(espBase);
    pollRef.current = setInterval(() => fetchStatus(espBase), 1000);
    return () => clearInterval(pollRef.current);
  }, [espBase, fetchStatus]);

  // ── Session ticker ────────────────────────────────────────────────────────
  // useEffect(() => {
  //   if (status?.active) {
  //     tickRef.current = setInterval(() => setSessionSeconds((s) => s + 1), 1000);
  //   } else {
  //     setSessionSeconds(0);
  //     clearInterval(tickRef.current);
  //   }
  //   return () => clearInterval(tickRef.current);
  // }, [status?.active]);

  // Session timer is controlled ONLY by the ESP32.
// Reset it immediately when there is no active session.
useEffect(() => {
  if (!status?.active) {
    setSessionSeconds(0);
  }
}, [status]);

  // ── Connect handler ───────────────────────────────────────────────────────
  const handleConnect = () => {
    const ip = espIP.trim().replace(/^https?:\/\//, '');
    if (!ip) return;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('esp32_ip', ip);
    }
    setEspBase(`http://${ip}`);
  };

  // ── Force Logout via ESP32 /logout ────────────────────────────────────────
  const forceLogout = async () => {
    if (!espBase) return;
    try {
      await fetch(`${espBase}/logout`, { signal: AbortSignal.timeout(3000) });
      setTimeout(() => fetchStatus(espBase), 300);
    } catch {
      alert('Could not reach ESP32. Check IP and WiFi.');
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const fmt = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const initials = (name = '') =>
    name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'OP';

  const exportCSV = () => {
    if (!logEntries.length) { alert('No log entries to export.'); return; }
    const headers = ['#', 'Time', 'Operator Name', 'Operator ID', 'Machine', 'Shift', 'Event'];
    const rows = logEntries.map((e, i) => [
      logEntries.length - i, e.time, e.name, e.id, e.machine, e.shift, e.action,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `Access_Log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const isLive = connStatus === 'Live';
  const isActive = status?.active === true;
  const machSt = status?.machine_status || 'Idle';

  const statusBadge = (st) => {
    const map = {
      Running: { bg: '#052e16', border: '#166534', color: '#4ade80', dot: '#4ade80' },
      Error: { bg: '#2d0a0e', border: '#7f1d1d', color: '#f87171', dot: '#f87171' },
      Maintenance: { bg: '#1c1503', border: '#78350f', color: '#fbbf24', dot: '#fbbf24' },
      Idle: { bg: '#0f172a', border: '#334155', color: '#94a3b8', dot: '#94a3b8' },
    };
    const c = map[st] || map.Idle;
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700,
        letterSpacing: '0.06em', textTransform: 'uppercase',
        background: c.bg, border: `1px solid ${c.border}`, color: c.color,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: c.dot,
          animation: st === 'Running' ? 'pulse 1.5s infinite' : 'none',
        }} />
        {st}
      </span>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh', background: '#020817', color: '#f1f5f9',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes tick  { 0%{opacity:1} 50%{opacity:.7} 100%{opacity:1} }
        * { box-sizing: border-box; margin:0; padding:0; }
        ::-webkit-scrollbar { width:5px; height:5px; }
        ::-webkit-scrollbar-track { background:#0f172a; }
        ::-webkit-scrollbar-thumb { background:#334155; border-radius:4px; }
        button { cursor:pointer; }
        input  { outline:none; }
        table  { border-collapse:collapse; width:100%; }
        th,td  { text-align:left; }
        .esp-ip-input::placeholder { color:#334155; }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{
        background: '#0f172a', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: 0, zIndex: 50, padding: '14px 24px',
      }}>
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>

          {/* Brand */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 22 }}>⚙️</span>
              <span style={{
                fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em',
                background: 'linear-gradient(90deg,#34d399,#60a5fa)', WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                Operator Mapping System
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              Real-time RFID operator-to-machine monitoring via ESP32
            </div>
          </div>

          {/* Connect bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              display: 'flex', background: '#020817', border: '1px solid #1e293b',
              borderRadius: 10, overflow: 'hidden',
            }}>
              <input
                className="esp-ip-input"
                type="text"
                placeholder="ESP32 IP  e.g. 192.168.1.100"
                value={espIP}
                onChange={(e) => setEspIP(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                style={{
                  background: 'transparent', color: '#34d399', fontSize: 13,
                  padding: '8px 14px', width: 230, fontFamily: 'monospace',
                  border: 'none',
                }}
              />
              <button onClick={handleConnect}
                style={{
                  background: '#10b981', color: '#020817', fontWeight: 700,
                  fontSize: 12, padding: '8px 18px', border: 'none',
                }}>
                Connect
              </button>
            </div>

            {/* Status pill */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '6px 14px',
              borderRadius: 99, fontSize: 12, fontWeight: 600, border: '1px solid',
              background: isLive ? '#052e1680' : connStatus === 'Connecting' ? '#1c140380' : '#0f172a',
              borderColor: isLive ? '#166534' : connStatus === 'Connecting' ? '#78350f' : '#1e293b',
              color: isLive ? '#4ade80' : connStatus === 'Connecting' ? '#fbbf24' : '#64748b',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', display: 'block',
                background: isLive ? '#4ade80' : connStatus === 'Connecting' ? '#fbbf24' : '#475569',
                animation: isLive ? 'pulse 1.5s infinite' : 'none',
              }} />
              {connStatus}
              {isLive && lastSeen && (
                <span style={{ fontSize: 10, color: '#64748b' }}>
                  · {lastSeen.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 20px' }}>

        {/* ── Stat Cards ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
          gap: 16, marginBottom: 28,
        }}>

          {[
            {
              label: 'Active Operators', value: isActive ? 1 : 0,
              sub: 'on duty', accent: '#10b981', icon: <UserIcon />,
            },
            {
              label: 'Machine Status', value: machSt,
              sub: isActive ? status?.machine_name : 'No session', accent: '#3b82f6', icon: <CpuIcon />,
            },
            {
              label: 'Current Shift', value: status?.shift || '—',
              sub: 'active shift', accent: '#8b5cf6', icon: <ClockIcon />,
            },
            {
              label: 'Session Time', value: isActive ? fmt(sessionSeconds) : '—',
              sub: isActive ? 'running' : 'idle', accent: '#f59e0b', icon: <ClockIcon />,
            },
          ].map((card, i) => (
            <div key={i} style={{
              background: '#0f172a', border: '1px solid #1e293b',
              borderRadius: 14, padding: '18px 20px', position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                background: card.accent, borderRadius: '14px 14px 0 0',
              }} />
              <div style={{
                fontSize: 11, color: '#64748b', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>{card.label}</div>
              <div style={{
                fontSize: 26, fontWeight: 900, color: '#f1f5f9',
                marginTop: 8, fontFamily: 'monospace',
              }}>{card.value}</div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>{card.sub}</div>
              <div style={{
                position: 'absolute', right: 16, bottom: 16, color: card.accent,
                background: `${card.accent}15`, padding: 8, borderRadius: 8,
              }}>
                {card.icon}
              </div>
            </div>
          ))}
        </div>

        {/* ── Two-column grid ── */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20,
          alignItems: 'start',
        }}>

          {/* LEFT: Active session + log */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Active Session Card */}
            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{
                padding: '16px 22px', borderBottom: '1px solid #1e293b',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Active Operator Session</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    Live data from ESP32 · auto-refreshes every 2s
                  </div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6,
                  background: isActive ? '#052e16' : '#0f172a',
                  color: isActive ? '#4ade80' : '#475569',
                  border: `1px solid ${isActive ? '#166534' : '#1e293b'}`,
                }}>
                  {isActive ? '1 Active' : 'No Session'}
                </span>
              </div>

              {/* Table */}
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr style={{ background: '#020817', borderBottom: '1px solid #1e293b' }}>
                      {['Operator ID', 'Name', 'Machine', 'Shift', 'UID', 'Duration', 'Status']
                        .map((h) => (
                          <th key={h} style={{
                            padding: '10px 18px', fontSize: 11, fontWeight: 700,
                            color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em',
                            whiteSpace: 'nowrap',
                          }}>
                            {h}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {isActive ? (
                      <tr style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{
                          padding: '14px 18px', fontFamily: 'monospace',
                          fontSize: 12, color: '#34d399', fontWeight: 700,
                        }}>
                          {status.operator_id || '—'}
                        </td>
                        <td style={{ padding: '14px 18px', fontWeight: 600, color: '#e2e8f0' }}>
                          {status.operator_name || '—'}
                        </td>
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ fontWeight: 600, color: '#cbd5e1' }}>
                            {status.machine_name || '—'}
                          </div>
                          <div style={{ fontSize: 11, color: '#475569' }}>
                            {status.machine_id || ''}
                          </div>
                        </td>
                        <td style={{
                          padding: '14px 18px', fontSize: 12,
                          color: '#94a3b8', fontWeight: 600,
                        }}>
                          {status.shift || '—'}
                        </td>
                        <td style={{
                          padding: '14px 18px', fontFamily: 'monospace',
                          fontSize: 11, color: '#64748b',
                        }}>
                          {status.uid || '—'}
                        </td>
                        <td style={{
                          padding: '14px 18px', fontFamily: 'monospace',
                          fontSize: 13, color: '#34d399', fontWeight: 700,
                          animation: 'tick 1s infinite',
                        }}>
                          {fmt(sessionSeconds)}
                        </td>
                        <td style={{ padding: '14px 18px' }}>
                          {statusBadge(machSt)}
                        </td>
                      </tr>
                    ) : (
                      <tr>
                        <td colSpan={7} style={{
                          padding: '48px 20px', textAlign: 'center',
                          color: '#475569', fontSize: 13,
                        }}>
                          <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
                          No active session · Scan an RFID card on the ESP32 to begin
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Action strip — only Force Logout (the only real endpoint) */}
              <div style={{
                padding: '12px 18px', borderTop: '1px solid #1e293b',
                background: '#020817', display: 'flex', justifyContent: 'flex-end',
              }}>
                <button
                  disabled={!isActive}
                  onClick={forceLogout}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                    background: isActive ? '#2d0a0e' : '#1e293b',
                    color: isActive ? '#f87171' : '#475569',
                    border: `1px solid ${isActive ? '#7f1d1d' : '#334155'}`,
                    cursor: isActive ? 'pointer' : 'not-allowed',
                    transition: 'all 0.15s',
                  }}>
                  <PowerIcon />
                  Force Logout
                </button>
              </div>
            </div>

            {/* Access Log */}
            <div style={{
              background: '#0f172a', border: '1px solid #1e293b',
              borderRadius: 14, overflow: 'hidden',
            }}>
              <div style={{
                padding: '16px 22px', borderBottom: '1px solid #1e293b',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Access Log</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    Login / logout events detected during this session
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={exportCSV}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                      background: '#10b981', color: '#020817', border: 'none',
                    }}>
                    <FileIcon />
                    Export CSV
                  </button>
                  <button onClick={() => fetchStatus(espBase)}
                    style={{
                      padding: 6, borderRadius: 8, background: '#020817',
                      border: '1px solid #1e293b', color: '#64748b',
                    }}>
                    <RefreshIcon />
                  </button>
                </div>
              </div>

              <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr style={{ background: '#020817', position: 'sticky', top: 0 }}>
                      {['#', 'Time', 'Operator', 'ID', 'Machine', 'Shift', 'Event'].map((h) => (
                        <th key={h} style={{
                          padding: '9px 16px', fontSize: 11, fontWeight: 700,
                          color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em',
                          borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap',
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logEntries.length > 0 ? logEntries.map((e, i) => {
                      const num = logEntries.length - i;
                      const isLogin = e.action === 'LOGIN';
                      const isLogout = e.action === 'LOGOUT';
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                          <td style={{
                            padding: '11px 16px', fontSize: 11,
                            color: '#475569', fontFamily: 'monospace',
                          }}>{num}</td>
                          <td style={{
                            padding: '11px 16px', fontSize: 11,
                            color: '#64748b', fontFamily: 'monospace', whiteSpace: 'nowrap',
                          }}>{e.time}</td>
                          <td style={{
                            padding: '11px 16px', fontWeight: 600,
                            color: '#e2e8f0', fontSize: 13,
                          }}>{e.name}</td>
                          <td style={{
                            padding: '11px 16px', fontFamily: 'monospace',
                            fontSize: 11, color: '#34d399',
                          }}>{e.id}</td>
                          <td style={{
                            padding: '11px 16px', fontSize: 12,
                            color: '#94a3b8',
                          }}>{e.machine}</td>
                          <td style={{
                            padding: '11px 16px', fontSize: 12,
                            color: '#64748b',
                          }}>{e.shift}</td>
                          <td style={{ padding: '11px 16px' }}>
                            {isLogin && (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                                background: '#052e16', color: '#4ade80', border: '1px solid #166534',
                              }}>
                                <span style={{
                                  width: 6, height: 6, borderRadius: '50%',
                                  background: '#4ade80',
                                }} />
                                LOGIN
                              </span>
                            )}
                            {isLogout && (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 700,
                                background: '#1e293b', color: '#94a3b8', border: '1px solid #334155',
                              }}>
                                <span style={{
                                  width: 6, height: 6, borderRadius: '50%',
                                  background: '#64748b',
                                }} />
                                LOGOUT
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={7} style={{
                          padding: '40px 20px', textAlign: 'center',
                          color: '#475569', fontSize: 12,
                        }}>
                          <div style={{ fontSize: 24, marginBottom: 6 }}>📝</div>
                          No events yet · events are captured automatically as cards are scanned
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* RIGHT: Session detail panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Session Detail */}
            <div style={{
              background: '#0f172a', border: '1px solid #1e293b',
              borderRadius: 14, overflow: 'hidden',
            }}>
              <div style={{ padding: '16px 22px', borderBottom: '1px solid #1e293b' }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Session Details</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {isActive ? `Machine: ${status?.machine_name}` : 'No active session'}
                </div>
              </div>

              <div style={{ padding: 24 }}>
                {isActive ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    {/* Avatar */}
                    <div style={{
                      width: 64, height: 64, borderRadius: '50%',
                      background: 'linear-gradient(135deg,#10b981,#3b82f6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 22, fontWeight: 900, color: '#020817',
                      boxShadow: '0 0 24px #10b98140', marginBottom: 12,
                    }}>
                      {initials(status.operator_name)}
                    </div>

                    <div style={{ fontWeight: 700, fontSize: 17, color: '#f1f5f9' }}>
                      {status.operator_name}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                      {status.operator_id}
                    </div>

                    {/* Timer */}
                    <div style={{
                      fontSize: 34, fontWeight: 900, color: '#34d399',
                      fontFamily: 'monospace', marginTop: 16, letterSpacing: '0.04em',
                      animation: 'tick 1s infinite',
                    }}>
                      {fmt(sessionSeconds)}
                    </div>
                    <div style={{
                      fontSize: 10, color: '#475569', textTransform: 'uppercase',
                      letterSpacing: '0.12em', marginTop: 4,
                    }}>session timer</div>

                    {/* Details list */}
                    <div style={{ width: '100%', marginTop: 22, fontSize: 12 }}>
                      {[
                        ['RFID UID', status.uid],
                        ['Machine ID', status.machine_id],
                        ['Machine Name', status.machine_name],
                        ['Shift', status.shift],
                        ['Machine Status', statusBadge(machSt)],
                        ['Session', fmt(sessionSeconds)],
                      ].map(([label, val]) => (
                        <div key={label} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 0', borderBottom: '1px solid #1e293b',
                        }}>
                          <span style={{ color: '#64748b' }}>{label}</span>
                          {typeof val === 'string'
                            ? <span style={{
                              color: '#cbd5e1', fontFamily: 'monospace', fontSize: 11,
                              fontWeight: 600,
                            }}>{val || '—'}</span>
                            : val}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569' }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>🔒</div>
                    <div style={{ fontWeight: 600, color: '#64748b', fontSize: 14 }}>
                      Reader Idle
                    </div>
                    <div style={{
                      fontSize: 12, color: '#334155', marginTop: 6,
                      lineHeight: 1.6,
                    }}>
                      Present an authorized RFID card to the ESP32 reader to start a session.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Registered Operators (hardcoded from Arduino) */}
            <div style={{
              background: '#0f172a', border: '1px solid #1e293b',
              borderRadius: 14, overflow: 'hidden',
            }}>
              <div style={{ padding: '16px 22px', borderBottom: '1px solid #1e293b' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Authorized Operators</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  Registered in ESP32 firmware
                </div>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { id: 'OP001', name: 'Farhan', uid: '50C06F1E' },
                  { id: 'OP002', name: 'Parvez', uid: '73793706' },
                  { id: 'OP003', name: 'ayaz', uid: '459AF605' },
                  { id: 'OP004', name: 'Pariya', uid: '7A42F505' },
                ].map((op) => {
                  const active = isActive && status?.uid === op.uid;
                  return (
                    <div key={op.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', borderRadius: 9,
                      background: active ? '#052e1680' : '#020817',
                      border: `1px solid ${active ? '#166534' : '#1e293b'}`,
                    }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                        background: active ? 'linear-gradient(135deg,#10b981,#3b82f6)' : '#1e293b',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700,
                        color: active ? '#020817' : '#64748b',
                      }}>
                        {initials(op.name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontWeight: 600, fontSize: 13,
                          color: active ? '#f1f5f9' : '#94a3b8',
                        }}>{op.name}</div>
                        <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>
                          {op.id} · {op.uid}
                        </div>
                      </div>
                      {active && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: '#4ade80',
                          background: '#052e16', border: '1px solid #166534',
                          padding: '2px 7px', borderRadius: 99,
                        }}>ACTIVE</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Machine Info */}
            <div style={{
              background: '#0f172a', border: '1px solid #1e293b',
              borderRadius: 14, overflow: 'hidden',
            }}>
              <div style={{ padding: '16px 22px', borderBottom: '1px solid #1e293b' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Machine Info</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  From ESP32 firmware
                </div>
              </div>
              <div style={{
                padding: '16px 20px', fontSize: 12, display: 'flex',
                flexDirection: 'column', gap: 8,
              }}>
                {[
                  ['Machine Name', status?.machine_name || 'CNC Machine'],
                  ['Machine ID', status?.machine_id || 'CNC-01'],
                  ['Status', statusBadge(machSt)],
                ].map(([label, val]) => (
                  <div key={label} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 0', borderBottom: '1px solid #1e293b',
                  }}>
                    <span style={{ color: '#64748b' }}>{label}</span>
                    {typeof val === 'string'
                      ? <span style={{
                        color: '#cbd5e1', fontFamily: 'monospace', fontSize: 12,
                        fontWeight: 600,
                      }}>{val}</span>
                      : val}
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}

export default OperatorsContent;
export { OperatorsContent };
