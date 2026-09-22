"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveOrganization } from "@/features/organizations/selection-actions";

type Props = { organizations: { id: string; name: string }[]; activeId: string };

export function OrganizationSwitcher({ organizations, activeId }: Readonly<Props>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="org-switcher">
      <span className="nav-label">Organização ativa</span>
      <select
        disabled={pending}
        onChange={(event) => {
          const value = event.target.value;
          startTransition(async () => {
            await setActiveOrganization(value);
            router.refresh();
          });
        }}
        value={activeId}
      >
        {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
      </select>
    </label>
  );
}
