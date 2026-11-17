# 🛍️ Agentic Commerce — Multi-Agent E-Commerce & Governance Engine

An autonomous, multi-agent AI commerce platform built with **Node.js 22 (native SQLite `DatabaseSync` + WAL mode)**, **React 19**, and **Tailwind CSS**. It features 5 specialized AI agents coordinated through structured tool schemas, strict permission policies, atomic concurrency control, and [Concord MCP](https://github.com/get-concord-ai/concord-mcp) multi-agent work-state tracking.

---

## 🌟 Architecture Highlights

```
                                  ┌───────────────────────────────┐
                                  │      Concord MCP Layer        │
                                  │ (Work-State, Claims, Handoffs)│
                                  └───────────────┬───────────────┘
                                                  │
                                                  ▼
                                   ┌─────────────────────────────┐
                                   │  AI Orchestration Gateway   │
                                   │ (PII Redaction, Rate Limits)│
                                   └──────────────┬──────────────┘
                                                  │
         ┌───────────────────┬────────────────────┼───────────────────┬───────────────────┐
         │                   │                    │                   │                   │
         ▼                   ▼                    ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌───────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Shopping Agent  │ │ Product Agent   │ │  Inventory Agent  │ │   Order Agent   │ │  Support Agent  │
│ (Recommendations│ │ (Specs, Reviews,│ │  (Stock Reserve,  │ │ (Status, Policy,│ │ (FAQ, Ticket   │
│   & Cart Assist)│ │    Comparisons) │ │   Serviceability) │ │  Cancellations) │ │   Resolution)   │
└────────┬────────┘ └────────┬────────┘ └─────────┬─────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                    │                    │                   │
         └───────────────────┴────────────────────┼────────────────────┴───────────────────┘
                                                  │ (Governed Tool Invocations)
                                                  ▼
                                   ┌─────────────────────────────┐
                                   │  Domain & Policy Engine     │
                                   │ (RBAC, IDOR, Atomic Stocks) │
                                   └──────────────┬──────────────┘
                                                  │
                                                  ▼
                                   ┌─────────────────────────────┐
                                   │   Node 22 `node:sqlite`     │
                                   │   (WAL Mode + Outbox Worker)│
                                   └─────────────────────────────┘
```

---

## 🤖 1. Multi-Agent Specialist Roles

Rather than using a single monolithic prompt, the system routes tasks to discrete specialist agents with isolated tool access and domain boundaries:

| Agent Key | Responsibility | Allowed Tools | Guardrail & Policies |
| :--- | :--- | :--- | :--- |
| **`shopping_agent`** | End-to-end shopping assistance, cart mutations, guided checkout. | `search_products`, `get_product_details`, `compare_products`, `check_stock`, `check_serviceability`, `add_to_cart`, `get_my_orders`, `request_cancellation`, `create_support_ticket` | Requires user confirmation for destructive actions; cannot execute financial refunds directly. |
| **`product_agent`** | In-depth product exploration, side-by-side comparison, customer review synthesis. | `search_products`, `get_product_details`, `compare_products`, `get_reviews_summary` | Read-only; cannot mutate cart or query user-specific orders. |
| **`inventory_agent`** | Authoritative stock checks and pin-code delivery ETAs. | `check_stock`, `check_serviceability` | High-frequency query caching; prevents inventory leakage. |
| **`order_agent`** | Order status tracking, cancellation requests, timeline verification. | `get_my_orders`, `get_order_status`, `request_cancellation` | Strict IDOR protection; user cannot inspect or cancel orders belonging to another customer. |
| **`support_agent`** | Help center search and autonomous ticket dispatching. | `search_help_articles`, `create_support_ticket`, `get_ticket_status` | PII redactor automatically scrubs card numbers, tokens, and passwords before ticket creation. |

---

## 🛡️ 2. Enterprise Security & Guardrails

1. **Deterministic PII Redaction (`redactSensitiveText`)**:
   - Card numbers (13-19 digits Luhn patterns) → `[REDACTED_CARD]`
   - CVV/CVC/PIN numbers → `[REDACTED]`
   - Bearer tokens & API Keys (`sk-`, `AIza`) → `[REDACTED_TOKEN]`
   - Sensitive password fields in JSON → `[REDACTED]`
2. **Multi-Role RBAC (`commercePolicy.ts`)**:
   - Enforces 7 granular roles (`CUSTOMER`, `SUPPORT`, `CATALOG_MANAGER`, `ORDER_MANAGER`, `INVENTORY_MANAGER`, `AI_ADMIN`, `ADMIN`).
   - Route-level and tool-level checks ensure customers never call admin or refund operations.
3. **Atomic Stock Reservation**:
   - Eliminates overselling via database transactions checking `on_hand - reserved >= quantity`.
   - Supports atomic rollback when payment fails or carts expire.
4. **Reliable Outbox Pattern**:
   - Webhook dispatches and order notifications are written to an `outbox` table within the same transaction as the business event.
   - A resilient background worker (`worker.ts`) polls and processes messages with exponential backoff and idempotency.

---

## 🤝 3. Concord MCP Coordination Layer

This repository is instrumented with **Concord MCP** (`@concord-ai/concord-mcp`) to coordinate multi-agent engineering workflows:
- **Workspace State**: Maintains local task claims and active agent presence via `.concord/`.
- **Collision Avoidance**: Prevents parallel agents from conflicting on schema migrations or policy code.
- **Context Preservation**: Enables shared task context and handoffs across different developer sessions and coding agents.

Run Concord inspection tools:
```bash
concord status    # View active agents, tasks, and file claims
concord who       # Inspect active agent presence
concord dashboard # Launch local live coordination view
```

---

## 💻 4. Tech Stack

* **Runtime & Backend**: Node.js v22+ (utilizing native `node:sqlite` `DatabaseSync` in WAL mode), Express 4, TypeScript.
* **AI Orchestration**: Google GenAI SDK (`@google/genai`), dynamic function calling schemas, tool validation engine.
* **Frontend**: React 19, Vite, Tailwind CSS v4, Lucide React, Motion.
* **Testing**: Node.js native test runner (`node:test`, `node:assert/strict`) covering RBAC, IDOR, race conditions, and AI guardrails.

---

## 🚀 5. Getting Started

### Prerequisites
- Node.js 22.x or later
- npm or bun

### 1. Installation
```bash
# Clone the repository
git clone https://github.com/Sathya2346/agentic-commerce.git
cd agentic-commerce

# Install dependencies
npm install --legacy-peer-deps
```

### 2. Environment Configuration
Create a `.env.local` file:
```bash
cp .env.example .env.local
```
Add your Gemini API key (optional for UI exploration, required for live LLM inference):
```env
GEMINI_API_KEY="your-gemini-api-key"
APP_URL="http://localhost:3000"
```

### 3. Run Development Server
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 4. Run Test Suite
```bash
node --test server/commerce.test.ts
```

---

## 👥 Demo Credentials
Pre-seeded in SQLite for immediate testing:
* **Customer**: `customer@example.com` / `CustomerPass123!`
* **Admin**: `admin@example.com` / `AdminPass123!`
* **Support**: `support@example.com` / `SupportPass123!`
* **Inventory Manager**: `inventory@example.com` / `InventoryPass123!`

---

## 📄 License
MIT © Sathya Ganesan
