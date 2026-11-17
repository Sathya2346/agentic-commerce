import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Coins,
  Download,
  GitBranch,
  Play,
  Plus,
  Save,
  Shield,
  Terminal,
  Wrench,
} from 'lucide-react';
import {
  Button,
  KpiCard,
  Modal,
  StatusBadge,
  statusToneForOrder,
} from '../../components/ui/DesignSystem';
import { useToast } from '../../context/ToastContext';
import { adminApi } from '../../services/api';
import { formatINR } from '../../domain/commercePolicy';

export function AdminAnalyticsPage() {
  const [data, setData] = useState<{
    topProducts: Record<string, unknown>[];
    funnel: { stage: string; count: number; conversion: number }[];
  } | null>(null);

  useEffect(() => {
    adminApi.analytics().then((res) => setData(res as unknown as typeof data)).catch(() => {});
  }, []);

  if (!data) return <div className="card-surface h-64 animate-pulse" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647]">Commerce & AI Funnel Analytics</h1>
        <p className="text-sm text-[#6B6680]">Storefront conversion funnel and top revenue-generating products</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-6 card-surface p-6 space-y-4">
          <h2 className="text-base font-bold text-[#1F1647]">Conversion Funnel</h2>
          <div className="space-y-3">
            {data.funnel.map((st) => (
              <div key={st.stage} className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span>{st.stage}</span>
                  <span className="tabular-nums">{st.count.toLocaleString('en-IN')} ({st.conversion}%)</span>
                </div>
                <div className="h-3 rounded-full bg-[#F3F0FA] overflow-hidden">
                  <div style={{ width: `${st.conversion}%` }} className="h-full bg-[#7C3AED] rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-6 card-surface p-6 space-y-4">
          <h2 className="text-base font-bold text-[#1F1647]">Top Revenue Products</h2>
          <div className="divide-y divide-[#E7E1F2] text-sm">
            {data.topProducts.map((p) => (
              <div key={String(p.id)} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-[#1F1647] truncate">{String(p.name)}</p>
                  <p className="text-xs text-[#6B6680]">{String(p.brand)} · {String(p.units_sold)} units sold</p>
                </div>
                <span className="font-bold text-[#7C3AED] tabular-nums">{formatINR(Number(p.revenue_paise))}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function AdminExportsAuditPage() {
  const { pushToast } = useToast();
  const [exportsList, setExportsList] = useState<Record<string, unknown>[]>([]);
  const [auditLogs, setAuditLogs] = useState<Record<string, unknown>[]>([]);

  const load = async () => {
    const [an, au] = await Promise.all([adminApi.analytics(), adminApi.auditLogs()]);
    setExportsList(an.exports);
    setAuditLogs(au.logs);
  };

  useEffect(() => {
    void load();
  }, []);

  const triggerExport = async (type: 'ORDERS' | 'INVENTORY') => {
    const res = await adminApi.createExport(type);
    const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentic-commerce-${type.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast({ variant: 'success', title: `${type} CSV exported (${res.rowCount} rows)` });
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1647]">CSV Export Center & Audit Logs</h1>
          <p className="text-sm text-[#6B6680]">Download verified SQL exports and inspect immutable governance trails</p>
        </div>
        <div className="flex gap-2.5">
          <Button size="sm" onClick={() => void triggerExport('ORDERS')}>
            <Download className="w-4 h-4" /> Export Orders CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => void triggerExport('INVENTORY')}>
            <Download className="w-4 h-4" /> Export Inventory CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-5 card-surface p-6 space-y-3">
          <h2 className="text-base font-bold text-[#1F1647]">Recent Export Jobs</h2>
          <div className="divide-y divide-[#E7E1F2] text-xs">
            {exportsList.map((e) => (
              <div key={String(e.id)} className="py-2.5 flex items-center justify-between">
                <div>
                  <p className="font-bold text-[#1F1647]">{String(e.report_type)} ({String(e.format)})</p>
                  <p className="text-[#6B6680]">{String(e.row_count)} rows · {new Date(String(e.created_at)).toLocaleString('en-IN')}</p>
                </div>
                <StatusBadge label={String(e.status)} tone="success" />
              </div>
            ))}
          </div>
        </section>

        <section className="lg:col-span-7 card-surface p-6 space-y-3">
          <h2 className="text-base font-bold text-[#1F1647]">Immutable Audit Log</h2>
          <div className="divide-y divide-[#E7E1F2] text-xs max-h-[420px] overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={String(log.id)} className="py-2.5 space-y-0.5">
                <div className="flex justify-between font-bold text-[#1F1647]">
                  <span>{String(log.action)} · {String(log.entity_type)}</span>
                  <span className="font-mono-tabular text-[#6B6680]">{String(log.correlation_id)}</span>
                </div>
                <p className="text-[#6B6680]">
                  Actor: {String(log.actor_type)} · {String(log.before_summary || '')} → {String(log.after_summary || '')}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function AdminSettingsPage() {
  const { pushToast } = useToast();
  const [freeShipInr, setFreeShipInr] = useState('999');
  const [gstPct, setGstPct] = useState('18');
  const [storeName, setStoreName] = useState('Agentic Commerce India');

  useEffect(() => {
    adminApi.settings().then((res) => {
      const gen = (res.settings.general as Record<string, unknown>) || {};
      if (gen.freeShippingThresholdPaise) setFreeShipInr(String(Number(gen.freeShippingThresholdPaise) / 100));
      if (gen.gstRateBps) setGstPct(String(Number(gen.gstRateBps) / 100));
      if (gen.storeName) setStoreName(String(gen.storeName));
    }).catch(() => {});
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await adminApi.saveSettings('general', {
      storeName,
      freeShippingThresholdPaise: Math.round(Number(freeShipInr) * 100),
      gstRateBps: Math.round(Number(gstPct) * 100),
      taxInclusive: true,
    });
    pushToast({ variant: 'success', title: 'Store settings persisted' });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647]">Store & Pricing Policy Settings</h1>
        <p className="text-sm text-[#6B6680]">Authoritative server-side tax and shipping threshold configuration</p>
      </div>
      <form onSubmit={save} className="card-surface p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold mb-1">Storefront Name</label>
          <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1">Free Shipping Threshold (INR)</label>
            <input type="number" value={freeShipInr} onChange={(e) => setFreeShipInr(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">GST Rate (%)</label>
            <input type="number" value={gstPct} onChange={(e) => setGstPct(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
          </div>
        </div>
        <Button type="submit"><Save className="w-4 h-4" /> Save Policy</Button>
      </form>
    </div>
  );
}

const ALL_ROLES = ['CUSTOMER', 'SUPPORT', 'CATALOG_MANAGER', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'AI_ADMIN', 'ADMIN'];

export function AdminRolesPage() {
  const { pushToast } = useToast();
  const [users, setUsers] = useState<{ id: string; name: string; email: string; roles: string[] }[]>([]);

  const load = async () => {
    const res = await adminApi.roles();
    setUsers(res.users as typeof users);
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleRole = async (u: { id: string; roles: string[] }, role: string) => {
    const has = u.roles.includes(role);
    const next = has ? u.roles.filter((r) => r !== role) : [...u.roles, role];
    if (next.length === 0) return;
    await adminApi.updateRoles(u.id, next);
    pushToast({ variant: 'success', title: 'RBAC roles updated' });
    await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647] flex items-center gap-2">
          <Shield className="w-6 h-6 text-[#7C3AED]" /> Roles & RBAC Matrix
        </h1>
        <p className="text-sm text-[#6B6680]">Least-privilege role assignment enforced across commerce, refund, and AI governance endpoints</p>
      </div>
      <div className="card-surface overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[780px]">
          <thead>
            <tr className="border-b border-[#E7E1F2] text-xs font-bold text-[#6B6680]">
              <th className="p-4">User</th>
              {ALL_ROLES.map((r) => <th key={r} className="p-3 text-center text-[10px]">{r}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E7E1F2] text-sm">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="p-4">
                  <p className="font-bold text-[#1F1647]">{u.name}</p>
                  <p className="text-xs text-[#6B6680]">{u.email}</p>
                </td>
                {ALL_ROLES.map((r) => (
                  <td key={r} className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={u.roles.includes(r)}
                      onChange={() => void toggleRole(u, r)}
                      className="rounded border-[#E7E1F2] text-[#7C3AED] cursor-pointer"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- AI ADMIN CONSOLE PAGES ----------------
export function AiOverviewPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    adminApi.aiOverview().then((res) => setData(res)).catch(() => {});
  }, []);

  if (!data) return <div className="card-surface h-64 animate-pulse" />;

  const metrics = (data.metrics as Record<string, number>) || {};
  const agents = (data.agents as Record<string, unknown>[]) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647]">Multi-Agent AI Governance Overview</h1>
        <p className="text-sm text-[#6B6680]">Orchestrator health, tool allowlist compliance, and Gemini runtime metrics</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Active Specialist Agents" value={String(metrics.activeAgents || 0)} icon={<Bot className="w-5 h-5" />} />
        <KpiCard label="Total Orchestrator Runs" value={String(metrics.totalRuns || 0)} icon={<Activity className="w-5 h-5" />} />
        <KpiCard label="Run Success Rate" value={`${metrics.successRate || 100}%`} icon={<CheckCircle2 className="w-5 h-5" />} />
        <KpiCard label="Estimated Token Cost" value={`$${(metrics.totalCostUsd || 0).toFixed(4)}`} trend={`${(metrics.totalTokens || 0).toLocaleString()} tokens`} icon={<Coins className="w-5 h-5" />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((ag) => (
          <div key={String(ag.id)} className="card-surface p-5 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-[#1F1647]">{String(ag.name)}</h2>
              <StatusBadge label={ag.enabled ? 'Enabled' : 'Paused'} tone={ag.enabled ? 'success' : 'danger'} />
            </div>
            <p className="text-xs text-[#6B6680]">{String(ag.role_title)} · v{String(ag.version)}</p>
            <p className="text-xs font-mono-tabular text-[#7C3AED]">{String(ag.model_name)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AiAgentsConfigPage() {
  const { pushToast } = useToast();
  const [agents, setAgents] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [prompt, setPrompt] = useState('');
  const [modelName, setModelName] = useState('gemini-4-hydrogen');
  const [maxSteps, setMaxSteps] = useState('5');
  const [enabled, setEnabled] = useState(true);
  const [allowedTools, setAllowedTools] = useState<string[]>([]);
  const [allTools, setAllTools] = useState<string[]>([]);

  const load = async () => {
    const [ov, tr] = await Promise.all([adminApi.aiOverview(), adminApi.tools()]);
    const list = (ov.agents as Record<string, unknown>[]) || [];
    setAgents(list);
    setAllTools(tr.tools.map((t) => String(t.name)));
    if (list[0] && !selected) selectAgent(list[0]);
  };

  const selectAgent = (ag: Record<string, unknown>) => {
    setSelected(ag);
    setPrompt(String(ag.system_prompt || ''));
    setModelName(String(ag.model_name || 'gemini-4-hydrogen'));
    setMaxSteps(String(ag.max_steps || 5));
    setEnabled(Boolean(ag.enabled));
    setAllowedTools(JSON.parse(String(ag.allowed_tools_json || '[]')));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveAgent = async (publish: boolean) => {
    if (!selected) return;
    const res = await adminApi.updateAgent(String(selected.agent_key), {
      systemPrompt: prompt,
      modelName,
      maxSteps: Number(maxSteps),
      enabled,
      allowedTools,
      publish,
    });
    pushToast({ variant: 'success', title: publish ? `Published v${res.version}` : 'Saved draft configuration' });
    await load();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647]">Agent Prompts, Models & Tool Allowlists</h1>
        <p className="text-sm text-[#6B6680]">Enforce strict tool allowlists and publish versioned instructions</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 space-y-2.5">
          {agents.map((ag) => (
            <button
              key={String(ag.agent_key)}
              type="button"
              onClick={() => selectAgent(ag)}
              className={`w-full card-surface p-4 text-left cursor-pointer ${
                selected?.agent_key === ag.agent_key ? 'border-[#7C3AED] bg-[#F3F0FA]/50' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[#1F1647]">{String(ag.name)}</span>
                <StatusBadge label={`v${String(ag.version)}`} tone="info" />
              </div>
              <p className="text-xs text-[#6B6680] mt-1">{String(ag.role_title)}</p>
            </button>
          ))}
        </div>

        <div className="lg:col-span-8 card-surface p-6 space-y-4">
          {selected && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-[#1F1647]">{String(selected.name)} ({String(selected.agent_key)})</h2>
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  Agent Enabled
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Gemini Model</label>
                  <select value={modelName} onChange={(e) => setModelName(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm font-mono-tabular">
                    <option value="gemini-4-hydrogen">gemini-4-hydrogen</option>
                    <option value="gemini-4-hydrogen-lite">gemini-4-hydrogen-lite</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Max Tool Loop Steps</label>
                  <input type="number" min={1} max={8} value={maxSteps} onChange={(e) => setMaxSteps(e.target.value)} className="w-full h-10 px-3 rounded-xl border border-[#E7E1F2] text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">System Instruction</label>
                <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="w-full p-3 rounded-xl border border-[#E7E1F2] text-sm" />
              </div>

              <div>
                <p className="text-xs font-semibold mb-2">Allowed Tool Capabilities</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {allTools.map((t) => (
                    <label key={t} className="flex items-center gap-2 p-2 rounded-xl border border-[#E7E1F2] text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allowedTools.includes(t)}
                        onChange={(e) =>
                          setAllowedTools((prev) =>
                            e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)
                          )
                        }
                      />
                      <span className="font-mono-tabular truncate">{t}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button variant="outline" onClick={() => void saveAgent(false)}>Save Draft</Button>
                <Button onClick={() => void saveAgent(true)}>Publish Version</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function AiWorkflowBuilderPage() {
  const { pushToast } = useToast();
  const [wf, setWf] = useState<{ id: string; name: string; status: string; version: number; nodes: { id: string; label: string; type: string; x: number; y: number }[]; edges: { from: string; to: string; condition: string }[] } | null>(null);

  const load = async () => {
    const res = await adminApi.workflow();
    if (res.workflow) setWf(res.workflow as typeof wf);
  };

  useEffect(() => {
    void load();
  }, []);

  if (!wf) return <div className="card-surface h-64 animate-pulse" />;

  const addGuardNode = () => {
    const id = `guard_${Date.now().toString().slice(-4)}`;
    setWf({
      ...wf,
      nodes: [...wf.nodes, { id, label: 'Policy Guardrail Check', type: 'guard', x: 320, y: 260 }],
      edges: [...wf.edges, { from: wf.nodes[0]?.id || 'shopping_agent', to: id, condition: 'pre_tool' }],
    });
  };

  const saveWorkflow = async (publish: boolean) => {
    const res = await adminApi.saveWorkflow(wf.id, {
      name: wf.name,
      nodes: wf.nodes,
      edges: wf.edges,
      publish,
    });
    pushToast({ variant: 'success', title: publish ? `Workflow published (v${res.version})` : 'Workflow draft saved' });
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1647] flex items-center gap-2">
            <GitBranch className="w-6 h-6 text-[#7C3AED]" /> Visual Multi-Agent Workflow Builder
          </h1>
          <p className="text-sm text-[#6B6680]">
            {wf.name} · v{wf.version} · {wf.status}
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button size="sm" variant="outline" onClick={addGuardNode}>
            <Plus className="w-4 h-4" /> Add Guardrail Node
          </Button>
          <Button size="sm" variant="outline" onClick={() => void saveWorkflow(false)}>Save Draft</Button>
          <Button size="sm" onClick={() => void saveWorkflow(true)}>Publish Graph</Button>
        </div>
      </div>

      <div className="card-surface p-6 bg-[#F8F7FC] space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {wf.nodes.map((node) => (
            <div key={node.id} className="bg-white border border-[#E7E1F2] rounded-2xl p-4 shadow-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono-tabular font-bold text-[#7C3AED] uppercase">{node.type}</span>
                <span className="text-[11px] text-[#6B6680] font-mono-tabular">{node.id}</span>
              </div>
              <p className="text-sm font-bold text-[#1F1647]">{node.label}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-[#E7E1F2] p-4 space-y-2">
          <p className="text-xs font-bold text-[#1F1647]">Routing Edges ({wf.edges.length})</p>
          <div className="flex flex-wrap gap-2">
            {wf.edges.map((ed, idx) => (
              <div key={idx} className="px-3 py-1.5 rounded-xl bg-[#F3F0FA] text-xs font-mono-tabular text-[#1F1647]">
                {ed.from} → {ed.to} ({ed.condition})
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AiLogsPage() {
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    adminApi.aiLogs().then((res) => {
      setRuns(res.runs);
      setEvents(res.events);
    }).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647] flex items-center gap-2">
          <Terminal className="w-6 h-6 text-[#7C3AED]" /> Redacted AI Execution Logs
        </h1>
        <p className="text-sm text-[#6B6680]">PII-redacted orchestrator traces with latency, tokens, and correlation IDs</p>
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[740px]">
          <thead>
            <tr className="border-b border-[#E7E1F2] text-xs font-bold text-[#6B6680] uppercase">
              <th className="p-4">Run ID</th>
              <th className="p-4">Prompt Summary</th>
              <th className="p-4">Latency</th>
              <th className="p-4">Tokens</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E7E1F2] text-sm">
            {runs.map((r) => (
              <tr key={String(r.id)}>
                <td className="p-4 font-mono-tabular text-xs font-bold text-[#7C3AED]">{String(r.id)}</td>
                <td className="p-4 max-w-md truncate">{String(r.prompt_summary)}</td>
                <td className="p-4 tabular-nums">{String(r.duration_ms)} ms</td>
                <td className="p-4 tabular-nums">{String(r.tokens_estimated)}</td>
                <td className="p-4"><StatusBadge label={String(r.status)} tone={statusToneForOrder(String(r.status))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-surface p-6 space-y-2">
        <h2 className="text-base font-bold text-[#1F1647]">Latest Tool Events</h2>
        <div className="divide-y divide-[#E7E1F2] text-xs max-h-80 overflow-y-auto">
          {events.map((ev) => (
            <div key={String(ev.id)} className="py-2 flex items-center justify-between gap-3">
              <span className="font-mono-tabular font-semibold">{String(ev.agent_key)} → {String(ev.tool_name || ev.event_type)}</span>
              <span className="text-[#6B6680] truncate max-w-lg">{String(ev.output_summary)}</span>
              <StatusBadge label={String(ev.status)} tone={statusToneForOrder(String(ev.status))} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AiToolRegistryPage() {
  const [tools, setTools] = useState<Record<string, unknown>[]>([]);
  const [testTarget, setTestTarget] = useState<Record<string, unknown> | null>(null);
  const [argsText, setArgsText] = useState('{"query":"laptop","maxPriceInr":60000}');
  const [testOutput, setTestOutput] = useState<string | null>(null);

  useEffect(() => {
    adminApi.tools().then((res) => setTools(res.tools)).catch(() => {});
  }, []);

  const runToolTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTarget) return;
    try {
      const parsed = JSON.parse(argsText);
      const res = await adminApi.testTool(String(testTarget.name), parsed);
      setTestOutput(JSON.stringify(res.outcome, null, 2));
    } catch (err) {
      setTestOutput(err instanceof Error ? err.message : 'Invalid JSON arguments');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647] flex items-center gap-2">
          <Wrench className="w-6 h-6 text-[#7C3AED]" /> Agent Tool Registry
        </h1>
        <p className="text-sm text-[#6B6680]">Authoritative function declarations and live sandbox tester</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((t) => (
          <div key={String(t.name)} className="card-surface p-5 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-mono-tabular font-bold text-[#1F1647]">{String(t.name)}</span>
                <StatusBadge label={t.authRequired ? 'Auth Required' : 'Public'} tone={t.authRequired ? 'warning' : 'success'} />
              </div>
              <p className="text-xs text-[#7C3AED] font-semibold mt-1">Owner: {String(t.ownerAgent)}</p>
              <p className="text-xs text-[#6B6680] mt-1.5">{String(t.description)}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTestTarget(t);
                setTestOutput(null);
                setArgsText(t.name === 'check_serviceability' ? '{"postalCode":"600040"}' : t.name === 'search_products' ? '{"category":"laptops","maxPriceInr":60000}' : '{}');
              }}
            >
              <Play className="w-3.5 h-3.5" /> Test Tool
            </Button>
          </div>
        ))}
      </div>

      <Modal open={Boolean(testTarget)} onClose={() => setTestTarget(null)} title={`Test Tool: ${String(testTarget?.name || '')}`} maxWidth="max-w-xl">
        <form onSubmit={runToolTest} className="space-y-3">
          <label className="block text-xs font-semibold">JSON Arguments</label>
          <textarea rows={3} value={argsText} onChange={(e) => setArgsText(e.target.value)} className="w-full p-3 rounded-xl border border-[#E7E1F2] font-mono-tabular text-xs" />
          <Button type="submit" size="sm">Execute Live Tool</Button>
          {testOutput && (
            <pre className="p-3 rounded-xl bg-[#1F1647] text-emerald-300 text-xs overflow-x-auto max-h-60">
              {testOutput}
            </pre>
          )}
        </form>
      </Modal>
    </div>
  );
}

export function AiEvaluationPage() {
  const { pushToast } = useToast();
  const [evals, setEvals] = useState<Record<string, unknown>[]>([]);
  const [running, setRunning] = useState(false);

  const load = async () => {
    const res = await adminApi.evaluations();
    setEvals(res.evaluations);
  };

  useEffect(() => {
    void load();
  }, []);

  const runSuite = async () => {
    setRunning(true);
    try {
      const res = await adminApi.runEvaluation();
      pushToast({ variant: 'success', title: `Evaluation scored ${String(res.scorePercent)}% (${String(res.passedCases)}/${String(res.totalCases)})` });
      await load();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1647]">AI Safety & Grounding Evaluation Suite</h1>
          <p className="text-sm text-[#6B6680]">Automated regression tests for catalog grounding, RBAC allowlists, guest restrictions, and PII redaction</p>
        </div>
        <Button onClick={() => void runSuite()} disabled={running}>
          <Play className="w-4 h-4" /> {running ? 'Running Suite...' : 'Run Evaluation Suite'}
        </Button>
      </div>

      <div className="space-y-4">
        {evals.map((ev) => {
          const cases = JSON.parse(String(ev.results_json || '[]')) as { name: string; passed: boolean }[];
          return (
            <div key={String(ev.id)} className="card-surface p-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#1F1647]">{String(ev.suite_name)}</h2>
                  <p className="text-xs text-[#6B6680]">{new Date(String(ev.created_at)).toLocaleString('en-IN')}</p>
                </div>
                <StatusBadge label={`${String(ev.score_percent)}% (${String(ev.passed_cases)}/${String(ev.total_cases)})`} tone={Number(ev.score_percent) === 100 ? 'success' : 'warning'} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {cases.map((c, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-[#F8F7FC] border border-[#E7E1F2] flex items-center justify-between text-xs">
                    <span>{c.name}</span>
                    <StatusBadge label={c.passed ? 'PASS' : 'FAIL'} tone={c.passed ? 'success' : 'danger'} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AiUsageCostPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    adminApi.aiOverview().then((res) => setData(res)).catch(() => {});
  }, []);

  if (!data) return <div className="card-surface h-64 animate-pulse" />;

  const metrics = (data.metrics as Record<string, number>) || {};
  const runs = (data.runs as Record<string, unknown>[]) || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1647]">AI Token Usage & Cost Metering</h1>
        <p className="text-sm text-[#6B6680]">Server-side token estimates and cost breakdown across Gemini orchestrator runs</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Total Tokens Consumed" value={(metrics.totalTokens || 0).toLocaleString('en-IN')} icon={<Activity className="w-5 h-5" />} />
        <KpiCard label="Estimated Spend (USD)" value={`$${(metrics.totalCostUsd || 0).toFixed(4)}`} icon={<Coins className="w-5 h-5" />} />
        <KpiCard label="Completed Runs" value={String(metrics.totalRuns || 0)} icon={<Bot className="w-5 h-5" />} />
      </div>

      <div className="card-surface overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-[#E7E1F2] text-xs font-bold text-[#6B6680] uppercase">
              <th className="p-4">Run ID</th>
              <th className="p-4">Model</th>
              <th className="p-4">Tokens</th>
              <th className="p-4">Cost (USD)</th>
              <th className="p-4">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E7E1F2] text-sm">
            {runs.map((r) => (
              <tr key={String(r.id)}>
                <td className="p-4 font-mono-tabular text-xs font-bold">{String(r.id)}</td>
                <td className="p-4 font-mono-tabular text-xs">{String(r.model_name)}</td>
                <td className="p-4 tabular-nums">{String(r.tokens_estimated)}</td>
                <td className="p-4 tabular-nums">${(Number(r.cost_microusd || 0) / 1_000_000).toFixed(5)}</td>
                <td className="p-4 tabular-nums">{String(r.duration_ms)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
