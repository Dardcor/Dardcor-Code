"use client";

import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";

const SIDEBAR_VERSION = "V0.1.4";

const mainNavItems = [
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
];

function NavItem({ item, active, onClick }) {
  const base = cn(
    "nav-item group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer",
    active
      ? "nav-item-active bg-primary/10 text-primary font-semibold border-l-2 border-primary"
      : "text-text-muted hover:text-text-main hover:bg-bg-hover"
  );

  const iconClass = cn(
    "material-symbols-outlined text-[18px]",
    active ? "text-primary fill-1" : "group-hover:text-primary transition-colors"
  );

  return (
    <Link href={item.href} onClick={onClick} className={base}>
      <span className={iconClass}>{item.icon}</span>
      <span className="text-[13px] font-medium flex-1">{item.label}</span>
    </Link>
  );
}

export default function Sidebar({ onClose }) {
  const pathname = usePathname();

  const isActive = (href) => {
    if (href === "/dashboard/usage") {
      return pathname === "/dashboard" || pathname === "/dashboard/usage" || pathname.startsWith("/dashboard/usage");
    }
    return pathname.startsWith(href);
  };

  return (
    <aside className="flex w-64 flex-col border-r border-border-subtle bg-sidebar transition-colors duration-300 min-h-full">
      {/* Logo */}
      <div className="px-5 py-5 flex flex-col gap-2 border-b border-border-subtle">
        <Link href="/dashboard/usage" className="flex items-center gap-3">
          <div className="flex items-center justify-center size-9 rounded-[var(--radius-brand)] shadow-[var(--shadow-warm)] overflow-hidden bg-[#121118] p-0.5 border border-[#262335]">
            <img src="/dardcor-code.png" alt="Dardcor Code" className="size-full object-contain" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-base font-semibold tracking-tight text-text-main">
              {APP_CONFIG.name}
            </h1>
            <span className="text-xs text-text-muted">{SIDEBAR_VERSION}</span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto custom-scrollbar">
        {mainNavItems.map((item) => (
          <NavItem
            key={item.href}
            item={item}
            active={isActive(item.href)}
            onClick={onClose}
          />
        ))}
      </nav>
    </aside>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
};

