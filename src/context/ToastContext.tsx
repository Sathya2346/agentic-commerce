import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  pushToast: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  const iconFor = (variant: ToastVariant) => {
    if (variant === 'success') return <CheckCircle2 className="w-5 h-5 text-[#10B981] shrink-0" />;
    if (variant === 'error') return <XCircle className="w-5 h-5 text-[#EF4444] shrink-0" />;
    if (variant === 'warning') return <AlertTriangle className="w-5 h-5 text-[#F59E0B] shrink-0" />;
    return <Info className="w-5 h-5 text-[#7C3AED] shrink-0" />;
  };

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-20 md:bottom-6 right-4 z-50 flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-[360px] pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto bg-white border border-[#E7E1F2] rounded-xl shadow-[0_10px_30px_rgba(31,22,71,0.12)] p-3.5 flex items-start gap-3"
          >
            {iconFor(t.variant)}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#211A35]">{t.title}</p>
              {t.description && <p className="text-xs text-[#6B6680] mt-0.5 leading-relaxed">{t.description}</p>}
              {t.actionLabel && t.onAction && (
                <button
                  type="button"
                  onClick={() => {
                    t.onAction?.();
                    dismiss(t.id);
                  }}
                  className="mt-1.5 text-xs font-semibold text-[#7C3AED] hover:underline"
                >
                  {t.actionLabel}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="text-[#6B6680] hover:text-[#211A35] p-1 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
