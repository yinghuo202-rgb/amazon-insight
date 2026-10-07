"use client";

import { useEffect, useRef, useState } from "react";

export function useInfiniteRows<T>(rows: T[], pageSize = 40) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const visible = rows.slice(0, visibleCount);
  const hasMore = visible.length < rows.length;

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisibleCount((current) => Math.min(current + pageSize, rows.length));
    }, { rootMargin: "500px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, pageSize, rows.length]);

  return { visible, hasMore, sentinelRef };
}
