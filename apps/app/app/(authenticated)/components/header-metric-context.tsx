"use client";

import { createContext, type ReactNode, useContext } from "react";

export interface HeaderMetricValue {
  brandName: string;
  sov: number;
}

const HeaderMetricContext = createContext<HeaderMetricValue | null>(null);

export const HeaderMetricProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value: HeaderMetricValue | null;
}) => (
  <HeaderMetricContext.Provider value={value}>
    {children}
  </HeaderMetricContext.Provider>
);

export const PersistentHeaderMetric = () => {
  const metric = useContext(HeaderMetricContext);
  if (!metric) {
    return null;
  }

  return (
    <div className="flex items-baseline gap-1.5 px-4">
      <span className="hidden text-[color:var(--findable-ink-subtle,#8a8f98)] text-xs sm:inline">
        {metric.brandName}
      </span>
      <span className="font-semibold text-[color:var(--findable-ink,#f7f8f8)] text-sm tabular-nums">
        {metric.sov}%
      </span>
      <span className="text-[color:var(--findable-ink-tertiary,#7e8289)] text-xs">
        AI 등장률
      </span>
    </div>
  );
};
