"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNavigation, type OrganizationRole } from "@/features/auth/permissions";

type Props = { role: OrganizationRole | null; isMaster: boolean };

function NavigationIcon({ href }: Readonly<{ href: string }>) {
  const icon = href === "/" ? "⌂" : href.startsWith("/locatarios") ? "◉" : href.startsWith("/contratos") ? "▣" : href.startsWith("/frota") ? "▱" : href.startsWith("/financeiro") ? "R$" : href.startsWith("/comunicacao") ? "◌" : href.startsWith("/configuracoes/equipe") ? "♙" : href.startsWith("/configuracoes") ? "⚙" : "◈";
  return <span aria-hidden="true" className="nav-icon">{icon}</span>;
}

function isActive(pathname: string, href: string) {
  if (href === "/" || href === "/comunicacao") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ role, isMaster }: Readonly<Props>) {
  const pathname = usePathname();
  const { primary, sections } = getNavigation(role, isMaster);

  return (
    <nav aria-label="Navegação principal">
      <Link aria-current={isActive(pathname, primary.href) ? "page" : undefined} className={`nav-item nav-item--primary${isActive(pathname, primary.href) ? " nav-item--active" : ""}`} href={primary.href}>
        <NavigationIcon href={primary.href} />
        <span>{primary.label}</span>
      </Link>
      {sections.map((section) => (
        <section className="nav-section" key={section.label}>
          <p className="nav-label">{section.label}</p>
          {section.items.map((item) => (
            <Link
              aria-current={isActive(pathname, item.href) ? "page" : undefined}
              className={`nav-item${isActive(pathname, item.href) ? " nav-item--active" : ""}`}
              href={item.href}
              key={item.href}
            >
              <NavigationIcon href={item.href} />
              <span>{item.label}</span>
            </Link>
          ))}
        </section>
      ))}
    </nav>
  );
}
