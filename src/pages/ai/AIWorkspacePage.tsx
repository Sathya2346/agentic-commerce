import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowLeftRight,
  Bookmark,
  Bot,
  CheckCircle2,
  Clock,
  MessageSquarePlus,
  Send,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  Button,
  EmptyState,
  Modal,
  ProductImage,
  StatusBadge,
  statusToneForOrder,
} from '../../components/ui/DesignSystem';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { aiApi } from '../../services/api';
import { formatINR } from '../../domain/commercePolicy';

const GUEST_TOKEN_KEY = 'ac_ai_guest_token_v1';

function getGuestToken(): string {
  let tok = localStorage.getItem(GUEST_TOKEN_KEY);
  if (!tok) {
    tok = `gst_${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(GUEST_TOKEN_KEY, tok);
  }
  return tok;
}

interface ProductCardPayload {
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  pricePaise: number;
  rating: number;
  availableToSell: number;
  imageUrl: string | null;
}

interface PendingConfirmation {
  actionType: string;
  orderId: string;
  orderNumber: string;
  reason: string;
  summary: string;
  resolved?: boolean;
  resolution?: string;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  cards?: ProductCardPayload[];
  pendingConfirmation?: PendingConfirmation | null;
  runId?: string | null;
  createdAt?: string;
}

const PROMPT_SUGGESTIONS = [
  'Best laptop under ₹60,000 for coding',
  'Compare Lenovo IdeaPad Slim 5 vs HP Victus 15',
  'Check delivery availability to PIN 600040',
  'What is my latest order status?',
  'What is the return and refund policy?',
];

export function AIWorkspacePage() {
  const { user } = useAuth();
  const { addToCart, toggleCompare } = useCart();
  const { pushToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const guestToken = getGuestToken();

  const [agents, setAgents] = useState<Record<string, unknown>[]>([]);
  const [conversations, setConversations] = useState<Record<string, unknown>[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [latestEvents, setLatestEvents] = useState<Record<string, unknown>[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [convSearch, setConvSearch] = useState('');
  const [inspectRun, setInspectRun] = useState<{ run: Record<string, unknown>; events: Record<string, unknown>[] } | null>(null);

  const chatFeedRef = useRef<HTMLDivElement>(null);

  const loadWorkspace = async () => {
    const [agRes, convRes] = await Promise.all([
      aiApi.agents(),
      aiApi.conversations(user ? undefined : guestToken),
    ]);
    setAgents(agRes.agents);
    setConversations(convRes.conversations);
    if (convRes.conversations.length > 0 && !activeConvId) {
      const firstId = String(convRes.conversations[0].id);
      setActiveConvId(firstId);
      await loadConversation(firstId);
    }
  };

  const loadConversation = async (id: string) => {
    const res = await aiApi.getConversation(id, user ? undefined : guestToken);
    setMessages(res.messages as unknown as ChatMessage[]);
    const lastRunMsg = [...res.messages].reverse().find((m) => m.runId);
    if (lastRunMsg?.runId) {
      setActiveRunId(String(lastRunMsg.runId));
      const runInfo = await aiApi.runDetail(String(lastRunMsg.runId)).catch(() => null);
      if (runInfo) setLatestEvents(runInfo.events);
    } else {
      setLatestEvents([]);
    }
  };

  useEffect(() => {
    void loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const initialPrompt = searchParams.get('prompt');
    if (initialPrompt) {
      setInput(initialPrompt);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (chatFeedRef.current) {
      chatFeedRef.current.scrollTo({ top: chatFeedRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages.length, sending]);

  const handleNewChat = async () => {
    const res = await aiApi.createConversation('New Shopping Session', user ? undefined : guestToken);
    const id = String(res.conversation.id);
    setConversations((prev) => [res.conversation, ...prev]);
    setActiveConvId(id);
    setMessages([]);
    setLatestEvents([]);
  };

  const handleSend = async (promptOverride?: string) => {
    const text = (promptOverride ?? input).trim();
    if (!text || sending) return;

    setSending(true);
    let convId = activeConvId;
    try {
      if (!convId) {
        const created = await aiApi.createConversation(text.slice(0, 60), user ? undefined : guestToken);
        convId = String(created.conversation.id);
        setActiveConvId(convId);
        setConversations((prev) => [created.conversation, ...prev]);
      }

      const optimisticUserMsg: ChatMessage = {
        id: `temp_${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUserMsg]);
      if (!promptOverride) setInput('');

      const res = await aiApi.sendMessage(convId, text, user ? undefined : guestToken);
      setMessages((prev) => [...prev.filter((m) => m.id !== optimisticUserMsg.id), { ...optimisticUserMsg, id: `usr_${Date.now()}` }, res.message as unknown as ChatMessage]);
      setActiveRunId(res.run.id);
      setLatestEvents(res.run.events);

      const convList = await aiApi.conversations(user ? undefined : guestToken);
      setConversations(convList.conversations);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: 'AI Orchestrator Error',
        description: err instanceof Error ? err.message : 'Unable to process message.',
      });
    } finally {
      setSending(false);
    }
  };

  const handleConfirmDecision = async (messageId: string, decision: 'APPROVE' | 'DECLINE') => {
    if (!activeConvId) return;
    try {
      const res = await aiApi.confirmAction(activeConvId, messageId, decision);
      setMessages((prev) => [
        ...prev.map((m) => (m.id === messageId ? { ...m, pendingConfirmation: res.pendingConfirmation as unknown as PendingConfirmation } : m)),
        res.message as unknown as ChatMessage,
      ]);
      pushToast({
        variant: decision === 'APPROVE' ? 'success' : 'info',
        title: decision === 'APPROVE' ? 'Action executed' : 'Action declined',
      });
    } catch (err) {
      pushToast({ variant: 'error', title: 'Confirmation failed', description: err instanceof Error ? err.message : 'Try again.' });
    }
  };

  const openRunInspector = async (runId: string) => {
    try {
      const detail = await aiApi.runDetail(runId);
      setInspectRun(detail);
    } catch {
      pushToast({ variant: 'error', title: 'Unable to load execution trace' });
    }
  };

  const filteredConversations = conversations.filter((c) =>
    String(c.title).toLowerCase().includes(convSearch.toLowerCase())
  );

  const activeAgentsInRun = new Set(latestEvents.map((e) => String(e.agent_key)));

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch lg:h-[calc(100vh-120px)] lg:overflow-hidden">
        {/* Left 240px Conversation & Shortcut Rail */}
        <aside className="lg:col-span-3 xl:col-span-2 card-surface p-4 flex flex-col gap-4 lg:h-full lg:overflow-hidden">
          <Button onClick={() => void handleNewChat()} className="w-full">
            <MessageSquarePlus className="w-4 h-4" /> New Chat
          </Button>

          <input
            type="search"
            value={convSearch}
            onChange={(e) => setConvSearch(e.target.value)}
            placeholder="Search sessions..."
            className="w-full h-9 px-3 rounded-xl border border-[#E7E1F2] bg-[#F8F7FC] text-xs"
          />

          <div className="flex-1 overflow-y-auto space-y-1.5 max-h-[340px] lg:max-h-none">
            {filteredConversations.map((c) => {
              const cid = String(c.id);
              const active = cid === activeConvId;
              return (
                <div
                  key={cid}
                  className={`group flex items-center justify-between gap-1.5 px-3 py-2 rounded-xl text-xs cursor-pointer ${
                    active ? 'bg-[#F3F0FA] text-[#7C3AED] font-semibold' : 'hover:bg-[#F8F7FC] text-[#211A35]'
                  }`}
                  onClick={() => {
                    setActiveConvId(cid);
                    void loadConversation(cid);
                  }}
                >
                  <span className="truncate">{String(c.title)}</span>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await aiApi.deleteConversation(cid, user ? undefined : guestToken);
                      setConversations((prev) => prev.filter((x) => String(x.id) !== cid));
                      if (activeConvId === cid) {
                        setActiveConvId(null);
                        setMessages([]);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-[#6B6680] hover:text-[#EF4444] p-0.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-[#E7E1F2] space-y-1 text-xs font-semibold">
            <Link to="/ai/saved" className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-[#F3F0FA] text-[#211A35]">
              <Bookmark className="w-4 h-4 text-[#7C3AED]" /> Saved Picks
            </Link>
            <Link to="/ai/activity" className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-[#F3F0FA] text-[#211A35]">
              <Activity className="w-4 h-4 text-[#7C3AED]" /> Agent Activity Logs
            </Link>
          </div>
        </aside>

        {/* Center Flexible Chat Canvas */}
        <section className="lg:col-span-6 xl:col-span-7 card-surface flex flex-col overflow-hidden min-h-[520px] lg:h-full">
          <div className="px-5 py-3.5 border-b border-[#E7E1F2] flex items-center justify-between gap-3 bg-white shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#7C3AED] text-white flex items-center justify-center">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-[#1F1647]">AI Shopping Workspace</h1>
                <p className="text-xs text-[#6B6680]">
                  Grounded in live catalog, inventory, and customer-scoped order tools
                </p>
              </div>
            </div>
            {activeRunId && (
              <Button size="sm" variant="outline" onClick={() => void openRunInspector(activeRunId)}>
                Inspect Trace
              </Button>
            )}
          </div>

          <div ref={chatFeedRef} className="flex-1 overflow-y-auto p-5 space-y-5 bg-[#F8F7FC]/60">
            {messages.length === 0 ? (
              <div className="py-10 text-center max-w-lg mx-auto space-y-5">
                <div className="w-14 h-14 rounded-2xl bg-[#F3F0FA] text-[#7C3AED] flex items-center justify-center mx-auto">
                  <Sparkles className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-[#1F1647]">What are you shopping for today?</h2>
                  <p className="text-sm text-[#6B6680] mt-1">
                    Our 5 specialist agents collaborate in real time to discover products, verify warehouse stock, check delivery PINs, or manage your orders.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {PROMPT_SUGGESTIONS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => void handleSend(chip)}
                      className="px-3.5 py-2 rounded-xl bg-white border border-[#E7E1F2] hover:border-[#7C3AED] text-xs font-medium text-[#211A35] cursor-pointer transition-colors"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-[#7C3AED] text-white rounded-br-sm'
                        : 'bg-white border border-[#E7E1F2] text-[#211A35] rounded-bl-sm shadow-sm'
                    }`}
                  >
                    {msg.content.split(/(\*\*[^*]+\*\*)/g).map((part, idx) =>
                      part.startsWith('**') && part.endsWith('**') ? (
                        <strong key={idx} className="font-semibold">
                          {part.slice(2, -2)}
                        </strong>
                      ) : (
                        <React.Fragment key={idx}>{part}</React.Fragment>
                      )
                    )}

                    {msg.runId && msg.role === 'assistant' && (
                      <div className="mt-2 pt-2 border-t border-[#E7E1F2] flex items-center justify-between gap-3 text-[11px] text-[#6B6680]">
                        <span>Run {msg.runId}</span>
                        <button
                          type="button"
                          onClick={() => void openRunInspector(msg.runId!)}
                          className="text-[#7C3AED] font-semibold hover:underline cursor-pointer"
                        >
                          View Tool Calls →
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Product Recommendation Cards inside Assistant Message */}
                  {msg.cards && msg.cards.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-[94%]">
                      {msg.cards.map((card) => (
                        <div key={card.variantId} className="bg-white border border-[#E7E1F2] rounded-2xl overflow-hidden shadow-sm flex flex-col">
                          <Link to={`/products/${card.slug}`} className="h-32 bg-[#F3F0FA] block">
                            <ProductImage src={card.imageUrl} alt={card.name} />
                          </Link>
                          <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                            <div>
                              <Link to={`/products/${card.slug}`} className="text-xs font-bold text-[#1F1647] hover:text-[#7C3AED] line-clamp-2">
                                {card.name}
                              </Link>
                              <div className="mt-1 flex items-center justify-between text-xs">
                                <span className="font-bold text-[#7C3AED] tabular-nums">{formatINR(card.pricePaise)}</span>
                                <span className={card.availableToSell > 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                                  {card.availableToSell > 0 ? `${card.availableToSell} in stock` : 'Sold out'}
                                </span>
                              </div>
                            </div>
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                className="flex-1 !h-8 !px-2 !text-xs"
                                disabled={card.availableToSell <= 0}
                                onClick={() =>
                                  void addToCart({
                                    variantId: card.variantId,
                                    productId: card.productId,
                                    slug: card.slug,
                                    name: card.name,
                                    imageUrl: card.imageUrl,
                                    unitPricePaise: card.pricePaise,
                                    quantity: 1,
                                    availableToSell: card.availableToSell,
                                  })
                                }
                              >
                                <ShoppingCart className="w-3 h-3" /> Add
                              </Button>
                              {user && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="!h-8 !px-2"
                                  aria-label={`Save ${card.name}`}
                                  onClick={async () => {
                                    await aiApi.saveRecommendation({
                                      productId: card.productId,
                                      variantId: card.variantId,
                                      reason: 'Recommended in AI chat',
                                      pricePaise: card.pricePaise,
                                    });
                                    pushToast({ variant: 'success', title: 'Saved recommendation' });
                                  }}
                                >
                                  <Bookmark className="w-3 h-3" />
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="!h-8 !px-2"
                                aria-label={`Compare ${card.name}`}
                                onClick={() => toggleCompare(card.slug, card.name)}
                              >
                                <ArrowLeftRight className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Explicit Confirmation Gate Card for Consequential Actions */}
                  {msg.pendingConfirmation && (
                    <div className="mt-3 w-full max-w-[85%] p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-3">
                      <div className="flex items-start gap-2.5">
                        <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-bold text-[#1F1647]">Action Requires Your Explicit Confirmation</p>
                          <p className="text-xs text-[#211A35] mt-1">{msg.pendingConfirmation.summary}</p>
                        </div>
                      </div>
                      {msg.pendingConfirmation.resolved ? (
                        <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" /> {msg.pendingConfirmation.resolution}
                        </p>
                      ) : (
                        <div className="flex gap-2.5">
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => void handleConfirmDecision(msg.id, 'APPROVE')}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Cancellation
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleConfirmDecision(msg.id, 'DECLINE')}
                          >
                            <XCircle className="w-3.5 h-3.5" /> Decline
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}

            {sending && (
              <div className="flex items-center gap-2 text-xs font-semibold text-[#7C3AED] bg-white border border-[#E7E1F2] rounded-2xl px-4 py-3 w-fit shadow-sm">
                <Bot className="w-4 h-4 animate-pulse" />
                Collaborating with specialist agents...
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="p-4 border-t border-[#E7E1F2] bg-white flex gap-2.5 shrink-0"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask for laptops under ₹60,000, live stock, PIN ETA, or order status..."
              aria-label="Message AI Shopping Assistant"
              className="flex-1 h-11 px-4 rounded-xl border border-[#E7E1F2] bg-[#F8F7FC] focus:bg-white focus:border-[#7C3AED] text-sm focus:outline-none"
            />
            <Button type="submit" disabled={sending || !input.trim()}>
              <Send className="w-4 h-4" /> Send
            </Button>
          </form>
        </section>

        {/* Right 260px Live Agent Collaboration Rail */}
        <aside className="lg:col-span-3 card-surface p-4 flex flex-col gap-4 lg:h-full lg:overflow-y-auto">
          <div className="flex items-center justify-between pb-2 border-b border-[#E7E1F2]">
            <h2 className="text-sm font-bold text-[#1F1647]">Live Agent Collaboration</h2>
            <span className="text-[11px] font-semibold text-[#7C3AED]">5 Specialists</span>
          </div>

          <div className="space-y-2.5">
            {agents.map((ag) => {
              const key = String(ag.agent_key);
              const participated = activeAgentsInRun.has(key);
              const enabled = Boolean(ag.enabled);
              return (
                <div
                  key={key}
                  className={`p-3 rounded-xl border transition-colors ${
                    participated ? 'border-[#7C3AED] bg-[#F3F0FA]/70' : 'border-[#E7E1F2] bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-[#1F1647] truncate">{String(ag.name)}</p>
                    <StatusBadge
                      label={!enabled ? 'Paused' : participated ? 'Active' : 'Ready'}
                      tone={!enabled ? 'danger' : participated ? 'info' : 'success'}
                    />
                  </div>
                  <p className="text-[11px] text-[#6B6680] mt-1">{String(ag.role_title)}</p>
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t border-[#E7E1F2] flex-1">
            <p className="text-xs font-bold text-[#1F1647] mb-2 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-[#7C3AED]" /> Recent Tool Execution
            </p>
            {latestEvents.length === 0 ? (
              <p className="text-xs text-[#6B6680]">Send a message to watch real-time agent routing and tool calls.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {latestEvents.map((ev) => (
                  <div key={String(ev.id)} className="p-2.5 rounded-xl bg-[#F8F7FC] border border-[#E7E1F2] text-[11px]">
                    <div className="flex items-center justify-between font-semibold text-[#1F1647]">
                      <span>{String(ev.agent_key)}</span>
                      <span className={ev.status === 'FAILED' ? 'text-[#EF4444]' : 'text-[#10B981]'}>
                        {String(ev.tool_name || ev.event_type)}
                      </span>
                    </div>
                    <p className="text-[#6B6680] mt-0.5 line-clamp-2">{String(ev.output_summary)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Run Trace Inspector Modal */}
      <Modal open={Boolean(inspectRun)} onClose={() => setInspectRun(null)} title="Agent Execution Trace" maxWidth="max-w-2xl">
        {inspectRun && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-[#F8F7FC] border border-[#E7E1F2] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div><p className="text-[#6B6680]">Run ID</p><p className="font-mono-tabular font-bold">{String(inspectRun.run.id)}</p></div>
              <div><p className="text-[#6B6680]">Status</p><p className="font-bold">{String(inspectRun.run.status)}</p></div>
              <div><p className="text-[#6B6680]">Model</p><p className="font-mono-tabular">{String(inspectRun.run.model_name)}</p></div>
              <div><p className="text-[#6B6680]">Latency</p><p className="tabular-nums font-bold">{String(inspectRun.run.duration_ms)} ms</p></div>
            </div>
            <div className="space-y-2.5">
              {inspectRun.events.map((ev) => (
                <div key={String(ev.id)} className="p-3 rounded-xl border border-[#E7E1F2] text-xs space-y-1">
                  <div className="flex items-center justify-between font-bold text-[#1F1647]">
                    <span>{String(ev.agent_key)} → {String(ev.tool_name || ev.event_type)}</span>
                    <StatusBadge label={String(ev.status)} tone={statusToneForOrder(String(ev.status))} />
                  </div>
                  <p className="text-[#6B6680] font-mono-tabular break-all">In: {String(ev.input_summary)}</p>
                  <p className="text-[#211A35] font-mono-tabular break-all">Out: {String(ev.output_summary)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function SavedRecommendationsPage() {
  const { user } = useAuth();
  const { addToCart } = useCart();
  const navigate = useNavigate();
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await aiApi.savedRecommendations();
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <EmptyState
          icon={<Bookmark className="w-7 h-7" />}
          title="Sign in to view saved AI picks"
          description="Bookmark products recommended by the Shopping Agent and compare live prices anytime."
          actionLabel="Sign In"
          onAction={() => navigate('/login')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-[#7C3AED]">AI Workspace</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647]">Saved Recommendations</h1>
        </div>
        <Link to="/ai"><Button size="sm" variant="outline">Back to AI Chat</Button></Link>
      </div>

      {loading ? (
        <div className="card-surface h-48 animate-pulse" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bookmark className="w-7 h-7" />}
          title="No saved AI recommendations yet"
          description="Ask the AI Assistant for recommendations and tap Save on any product card."
          actionLabel="Open AI Workspace"
          onAction={() => navigate('/ai')}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {items.map((it) => (
            <div key={String(it.id)} className="card-surface overflow-hidden flex flex-col">
              <Link to={`/products/${String(it.slug)}`} className="h-40 bg-[#F3F0FA] block">
                <ProductImage src={it.image_url ? String(it.image_url) : null} alt={String(it.name)} />
              </Link>
              <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                <div>
                  <p className="text-xs text-[#6B6680]">{String(it.brand)} · {String(it.reason)}</p>
                  <Link to={`/products/${String(it.slug)}`} className="text-sm font-bold text-[#1F1647] mt-0.5 block">
                    {String(it.name)}
                  </Link>
                  <p className="text-base font-bold text-[#7C3AED] mt-1 tabular-nums">{formatINR(Number(it.current_price_paise))}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={Number(it.availableToSell) <= 0}
                    onClick={() =>
                      void addToCart({
                        variantId: String(it.variant_id),
                        productId: String(it.product_id),
                        slug: String(it.slug),
                        name: String(it.name),
                        unitPricePaise: Number(it.current_price_paise),
                        quantity: 1,
                        availableToSell: Number(it.availableToSell),
                      })
                    }
                  >
                    Add to Cart
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await aiApi.removeSaved(String(it.id));
                      await load();
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-[#EF4444]" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentActivityPage() {
  const { runId } = useParams<{ runId?: string }>();
  const [runs, setRuns] = useState<Record<string, unknown>[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<{ run: Record<string, unknown>; events: Record<string, unknown>[] } | null>(null);

  useEffect(() => {
    aiApi.runs().then((res) => setRuns(res.runs)).catch(() => {});
    if (runId) {
      aiApi.runDetail(runId).then((d) => setSelectedDetail(d)).catch(() => {});
    }
  }, [runId]);

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#7C3AED]">Observability</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#1F1647]">Agent Activity & Run Inspector</h1>
        </div>
        <Link to="/ai"><Button size="sm">Open AI Workspace</Button></Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 space-y-3">
          {runs.map((r) => (
            <button
              key={String(r.id)}
              type="button"
              onClick={() => void aiApi.runDetail(String(r.id)).then((d) => setSelectedDetail(d))}
              className="w-full card-surface card-surface-hover p-4 text-left flex items-center justify-between gap-3 cursor-pointer"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono-tabular font-bold text-[#7C3AED]">{String(r.id)}</span>
                  <StatusBadge label={String(r.status)} tone={statusToneForOrder(String(r.status))} />
                </div>
                <p className="text-sm font-semibold text-[#1F1647] mt-1 truncate">{String(r.prompt_summary)}</p>
                <p className="text-xs text-[#6B6680] mt-0.5 flex items-center gap-2">
                  <Clock className="w-3 h-3" /> {String(r.duration_ms)} ms · {String(r.model_name)}
                </p>
              </div>
              <span className="text-xs font-semibold text-[#7C3AED] shrink-0">Inspect →</span>
            </button>
          ))}
        </div>

        <div className="lg:col-span-6 card-surface p-6">
          {!selectedDetail ? (
            <p className="text-sm text-[#6B6680]">Select a run on the left to inspect every redacted tool execution step.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#E7E1F2] pb-3">
                <div>
                  <h2 className="text-base font-bold text-[#1F1647] font-mono-tabular">{String(selectedDetail.run.id)}</h2>
                  <p className="text-xs text-[#6B6680]">{String(selectedDetail.run.prompt_summary)}</p>
                </div>
                <StatusBadge label={String(selectedDetail.run.status)} tone={statusToneForOrder(String(selectedDetail.run.status))} />
              </div>
              <div className="space-y-2.5">
                {selectedDetail.events.map((ev) => (
                  <div key={String(ev.id)} className="p-3 rounded-xl bg-[#F8F7FC] border border-[#E7E1F2] text-xs space-y-1">
                    <div className="flex justify-between font-bold text-[#1F1647]">
                      <span>{String(ev.agent_key)} · {String(ev.tool_name || ev.event_type)}</span>
                      <span>{String(ev.duration_ms)} ms</span>
                    </div>
                    <p className="text-[#6B6680] font-mono-tabular break-all">{String(ev.output_summary)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
