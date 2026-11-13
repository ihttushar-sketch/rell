"use client";

import { useEffect } from "react";
import { ExtractorTab } from "@/components/ExtractorTab";
import { ProduceTab } from "@/components/ProduceTab";
import { Shell } from "@/components/Shell";
import { Toasts } from "@/components/Toasts";
import { VaultTab } from "@/components/VaultTab";
import { useStudio } from "@/lib/store";

export default function StudioPage() {
  const { tab, hydrateVault, setTab } = useStudio();

  useEffect(() => {
    void hydrateVault();
  }, [hydrateVault]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      if (event.key === "1") setTab("extractor");
      if (event.key === "2") setTab("produce");
      if (event.key === "3") setTab("vault");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setTab]);

  return (
    <>
      <Shell>
        {tab === "extractor" ? <ExtractorTab /> : null}
        {tab === "produce" ? <ProduceTab /> : null}
        {tab === "vault" ? <VaultTab /> : null}
      </Shell>
      <Toasts />
    </>
  );
}
