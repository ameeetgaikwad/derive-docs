"use client";

export default function TerminalCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {/* Tab */}
      <div
        className="relative inline-flex items-center gap-2 font-mono text-sm"
        style={{
          background: "#0d0d0d",
          color: "#ffffff",
          padding: "10px 44px 10px 16px",
          borderRadius: "8px 8px 0 0",
          clipPath:
            "polygon(0 0, calc(100% - 24px) 0, 100% 100%, 0 100%)",
        }}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: "#22c55e" }}
        />
        {title}
      </div>
      {/* Card body */}
      <div
        className="overflow-hidden border"
        style={{
          background: "#ffffff",
          borderColor: "#d4cfc6",
          borderRadius: "0 8px 8px 8px",
          boxShadow: "5px 6px 0px rgba(0,0,0,0.18)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
