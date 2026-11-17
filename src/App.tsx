/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { ToastProvider } from './context/ToastContext';
import CustomerLayout from './layouts/CustomerLayout';
import AdminLayout from './layouts/AdminLayout';
import AuthLayout from './layouts/AuthLayout';
import {
  AccessDeniedPage,
  ForgotPasswordPage,
  RegisterPage,
  ResetPasswordPage,
  SessionExpiredPage,
  SignInPage,
  VerifyEmailPage,
} from './pages/auth/AuthPages';
import HomePage from './pages/customer/HomePage';
import { CategoriesPage, ComparePage, ShopPage } from './pages/customer/ShopPages';
import ProductDetailPage from './pages/customer/ProductDetailPage';
import { CartPage, CheckoutPage, OrderSuccessPage } from './pages/customer/CartCheckoutPages';
import {
  AccountPage,
  HelpPage,
  NotificationsPage,
  OrderDetailPage,
  OrdersPage,
  SupportTicketDetailPage,
  SupportTicketsPage,
  WishlistPage,
} from './pages/customer/OrdersAccountSupportPages';
import {
  AgentActivityPage,
  AIWorkspacePage,
  SavedRecommendationsPage,
} from './pages/ai/AIWorkspacePage';
import {
  AdminCustomersPage,
  AdminDashboardPage,
  AdminInventoryPage,
  AdminOrdersPage,
  AdminPaymentsPage,
  AdminProductsPage,
  AdminSupportQueuePage,
} from './pages/admin/AdminCommercePages';
import {
  AdminAnalyticsPage,
  AdminExportsAuditPage,
  AdminRolesPage,
  AdminSettingsPage,
  AiAgentsConfigPage,
  AiEvaluationPage,
  AiLogsPage,
  AiOverviewPage,
  AiToolRegistryPage,
  AiUsageCostPage,
  AiWorkflowBuilderPage,
} from './pages/admin/AdminGovernanceAndAIPages';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center text-sm text-[#6B6680]">
        Verifying session...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}

function RequireStaff({ children }: { children: React.ReactNode }) {
  const { user, isStaff, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#6B6680]">
        Verifying staff access...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (!isStaff) {
    return <Navigate to="/403" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <CartProvider>
            <Routes>
              {/* Auth Shell */}
              <Route element={<AuthLayout />}>
                <Route path="/login" element={<SignInPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/session-expired" element={<SessionExpiredPage />} />
                <Route path="/403" element={<AccessDeniedPage />} />
              </Route>

              {/* Customer & AI Storefront Shell */}
              <Route element={<CustomerLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/home" element={<RequireAuth><HomePage customerHome /></RequireAuth>} />
                <Route path="/shop" element={<ShopPage />} />
                <Route path="/categories" element={<CategoriesPage />} />
                <Route path="/categories/:slug" element={<ShopPage />} />
                <Route path="/products/:slug" element={<ProductDetailPage />} />
                <Route path="/compare" element={<ComparePage />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
                <Route path="/orders/success/:orderId" element={<RequireAuth><OrderSuccessPage /></RequireAuth>} />
                <Route path="/orders" element={<RequireAuth><OrdersPage /></RequireAuth>} />
                <Route path="/orders/:id" element={<RequireAuth><OrderDetailPage /></RequireAuth>} />
                <Route path="/wishlist" element={<WishlistPage />} />
                <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
                <Route path="/notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
                <Route path="/help" element={<HelpPage />} />
                <Route path="/support/tickets" element={<RequireAuth><SupportTicketsPage /></RequireAuth>} />
                <Route path="/support/tickets/:id" element={<RequireAuth><SupportTicketDetailPage /></RequireAuth>} />

                {/* Multi-Agent AI Workspace */}
                <Route path="/ai" element={<AIWorkspacePage />} />
                <Route path="/ai/saved" element={<SavedRecommendationsPage />} />
                <Route path="/ai/activity" element={<AgentActivityPage />} />
                <Route path="/ai/activity/:runId" element={<AgentActivityPage />} />
              </Route>

              {/* Admin & AI Governance Shell */}
              <Route path="/admin" element={<RequireStaff><AdminLayout /></RequireStaff>}>
                <Route index element={<AdminDashboardPage />} />
                <Route path="products" element={<AdminProductsPage />} />
                <Route path="inventory" element={<AdminInventoryPage />} />
                <Route path="orders" element={<AdminOrdersPage />} />
                <Route path="payments" element={<AdminPaymentsPage />} />
                <Route path="customers" element={<AdminCustomersPage />} />
                <Route path="support" element={<AdminSupportQueuePage />} />
                <Route path="analytics" element={<AdminAnalyticsPage />} />
                <Route path="exports" element={<AdminExportsAuditPage />} />
                <Route path="settings" element={<AdminSettingsPage />} />
                <Route path="roles" element={<AdminRolesPage />} />
                <Route path="ai-overview" element={<AiOverviewPage />} />
                <Route path="agents" element={<AiAgentsConfigPage />} />
                <Route path="workflows" element={<AiWorkflowBuilderPage />} />
                <Route path="ai-logs" element={<AiLogsPage />} />
                <Route path="tools" element={<AiToolRegistryPage />} />
                <Route path="evaluation" element={<AiEvaluationPage />} />
                <Route path="ai-usage" element={<AiUsageCostPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </CartProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
