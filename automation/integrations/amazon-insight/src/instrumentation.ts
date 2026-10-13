const server = globalThis as typeof globalThis & { measuremanReviewHookStarted?: boolean };

export function register() {
  // Next sets NEXT_PHASE during production prerendering. Never let a build
  // modify account/operational data, and never bundle Node storage for Edge.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV !== "production" || ["phase-production-build", "phase-export"].includes(process.env.NEXT_PHASE ?? "")
      || process.env.NEXT_IS_EXPORT_WORKER === "true" || server.measuremanReviewHookStarted) return;
    server.measuremanReviewHookStarted = true;
    const initial = setTimeout(() => {
      void import("@/lib/inventory/operating-review-reconcile")
        .then(module => { module.startOperatingReviewReconciliation(); })
        .catch(() => { server.measuremanReviewHookStarted = false; console.warn("经营复核自动协调未启动；请检查应用运行诊断，已发布报告不会回滚。"); });
    }, 0);
    initial.unref?.();
  }
}
