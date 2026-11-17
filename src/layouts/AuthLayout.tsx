import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { Bot, ShieldCheck, Zap } from 'lucide-react';
import { BrandMark } from '../components/ui/DesignSystem';

export default function AuthLayout() {
  return (
    <div className="min-h-screen bg-[#F8F7FC] flex flex-col justify-center py-8 px-4 sm:px-6">
      <div className="max-w-[1040px] w-full mx-auto bg-white rounded-[24px] border border-[#E7E1F2] shadow-[0_10px_30px_rgba(31,22,71,0.08)] overflow-hidden grid grid-cols-1 md:grid-cols-12">
        <div className="md:col-span-5 aurora-hero-gradient text-white p-8 md:p-10 flex flex-col justify-between gap-8">
          <div>
            <Link to="/">
              <BrandMark light />
            </Link>
            <h1 className="mt-8 text-2xl md:text-3xl font-bold leading-tight text-balance">
              Shop Smarter with Five Collaborating AI Agents
            </h1>
            <p className="mt-3 text-sm text-white/80 leading-relaxed">
              Verified live inventory, transparent INR pricing, and instant order tracking built on authoritative server-side controls.
            </p>
          </div>
          <div className="space-y-3 text-xs text-white/90">
            <div className="flex items-center gap-2.5">
              <Bot className="w-4 h-4 text-[#A78BFA] shrink-0" />
              <span>5 Specialist Agents · Product, Inventory, Order, Support</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Zap className="w-4 h-4 text-[#A78BFA] shrink-0" />
              <span>Automatic guest cart merge upon sign in</span>
            </div>
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-[#A78BFA] shrink-0" />
              <span>Role-based access & signed payment verification</span>
            </div>
          </div>
        </div>

        <div className="md:col-span-7 p-6 sm:p-10 flex flex-col justify-center">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
