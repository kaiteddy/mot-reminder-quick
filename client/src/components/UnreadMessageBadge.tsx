import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface UnreadMessageBadgeProps {
  onNewMessage?: () => void;
}

export function UnreadMessageBadge({ onNewMessage }: UnreadMessageBadgeProps) {
  const [previousCount, setPreviousCount] = useState<number | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  
  // Poll for unread count every 10 seconds
  const { data: unreadCount = 0, error } = trpc.messages.getUnreadCount.useQuery(undefined, {
    refetchInterval: 10000, // 10 seconds
    refetchIntervalInBackground: true,
    retry: 3,
    retryDelay: 1000,
  });
  
  // Log errors but don't crash
  useEffect(() => {
    if (error) {
      console.error("[UnreadMessageBadge] Error fetching unread count:", error);
    }
  }, [error]);

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        setHasPermission(true);
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((permission) => {
          setHasPermission(permission === "granted");
        });
      }
    }
  }, []);

  // Detect new messages and show notification
  useEffect(() => {
    if (previousCount !== null && unreadCount > previousCount) {
      const newMessages = unreadCount - previousCount;
      
      // Show toast notification
      toast.info(`${newMessages} new customer ${newMessages === 1 ? 'message' : 'messages'}!`, {
        duration: 5000,
      });
      
      // Show browser notification if permission granted
      if (hasPermission && "Notification" in window) {
        new Notification("New Customer Message", {
          body: `You have ${newMessages} new ${newMessages === 1 ? 'message' : 'messages'} from customers`,
          icon: "/favicon.ico",
          tag: "customer-message",
        });
      }
      
      // Call callback if provided
      onNewMessage?.();
    }
    
    setPreviousCount(unreadCount);
  }, [unreadCount, previousCount, hasPermission, onNewMessage]);

  if (unreadCount === 0) {
    return null;
  }

  return (
    <Badge variant="destructive" className="ml-2 px-2 py-0.5 text-xs">
      {unreadCount}
    </Badge>
  );
}
