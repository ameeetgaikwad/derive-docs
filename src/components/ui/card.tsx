import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  terminalPath?: string;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, terminalPath, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-md border-2 border-border bg-card overflow-hidden", className)}
      {...props}
    >
      {terminalPath && (
        <div className="flex items-center gap-2 border-b-2 border-border bg-foreground px-3 py-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-success" />
          <span className="font-mono text-xs text-primary-foreground">{terminalPath}</span>
        </div>
      )}
      <div className={terminalPath ? "p-6" : "p-6"}>
        {children}
      </div>
    </div>
  )
);
Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 pb-4", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-lg font-semibold leading-none font-mono", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

export { Card, CardHeader, CardTitle, CardContent };
export type { CardProps };
