import * as React from "react";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export type AsideCardProps = React.ComponentPropsWithoutRef<"aside">;

const AsideCard = React.forwardRef<HTMLElement, AsideCardProps>(
  ({ className, ...props }, ref) => {
    return (
      <aside
        ref={ref}
        className={cn(
          "flex flex-col overflow-hidden rounded-lg border-[0.5px] border-zinc-200 bg-background shadow-[0_0_30px_0_rgba(0,0,0,0.05)]",
          className
        )}
        {...props}
      />
    );
  }
);
AsideCard.displayName = "AsideCard";

export type AsideHeaderProps = React.ComponentPropsWithoutRef<"div">;

export const AsideHeader = React.forwardRef<HTMLDivElement, AsideHeaderProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center justify-between border-b-[0.5px] border-zinc-200 bg-zinc-100 p-5 transition-colors duration-300",
          className
        )}
        {...props}
      />
    );
  }
);
AsideHeader.displayName = "AsideHeader";

export type AsideTitleProps = React.ComponentPropsWithoutRef<typeof Text>;

export function AsideTitle({ className, children, ...props }: AsideTitleProps) {
  return (
    <Text className={cn("font-mono", className)} variant="terminal-small" {...props}>
      {children}
    </Text>
  );
}

export type AsideActionsProps = React.ComponentPropsWithoutRef<"div">;

export const AsideActions = React.forwardRef<HTMLDivElement, AsideActionsProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex cursor-pointer items-center gap-2", className)}
        {...props}
      />
    );
  }
);
AsideActions.displayName = "AsideActions";

export type AsideContentProps = React.ComponentPropsWithoutRef<"div">;

export const AsideContent = React.forwardRef<HTMLDivElement, AsideContentProps>(
  ({ className, ...props }, ref) => {
    return <div ref={ref} className={cn("p-5 sm:p-[1.875rem]", className)} {...props} />;
  }
);
AsideContent.displayName = "AsideContent";

export type AsideFooterProps = React.ComponentPropsWithoutRef<"div">;

export function AsideFooter({ className, ...props }: AsideFooterProps) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-between border-t-[0.5px] border-zinc-200 bg-white/90 px-5 py-5 backdrop-blur-[2.5px] sm:px-[1.875rem]",
        className
      )}
      {...props}
    />
  );
}

export default AsideCard;
